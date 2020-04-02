let express = require('express');
let Webtorrent = require('webtorrent');
let parseRange = require('range-parser');
let rimraf = require('rimraf');

const app = express();

// once the server starts, a new  webtorrent client will start.
const client = new Webtorrent();

// destroy torrent download and delete files
const destroy = torrent => {
	torrent.destroy(() => {
		console.log("destroyed", torrent.path);
		rimraf(torrent.path, {maxBusyTries: 10}, e => {
			if (e) {
				console.error(e);
			} else {
				console.log("deleted file");
			}
		});
	});
};

// stream buffer with the required headers
const seekable = (file, req, res) => {
	try {
		res.set("Accept-Ranges", "bytes");
		res.set("Conent-Length", file.length);
		const ranges = parseRange(file.length, req.headers.range || "");
		if (ranges === -1) {
			// unsatisfiable range
			res.set("Content-Range", "*/" + file.length);
			res.sendStatus(416);
		}

		const {start, end} = ranges[0];
		res.status(206);
		res.set("Content-Length", (end - start) + 1); //end is inclusive.
		res.set("Content-Range", `bytes ${start}-${end}/${file.length}`);

		const stream = file.createReadStream({start, end});
		stream.pipe(res);
	} catch (e){
		const stream = file.createReadStream();
		stream.pipe(res);
	}
};

app.use("/stream", (req, res, next) => {
	res.sendSeekable = file => {
		seekable(file, req, res);
	};
	next();
});

const validateInfoHash = (req, res, next) => {
	if (req.params.hash === "" || typeof req.params.hash === "undefined") {
		res.status(500).send("invalid infoHash");
	} else {
		next();
	}
};

app.get("/stream/:hash", validateInfoHash, (req, res) => {
	try {
		const torrent = client.get(req.params.hash);
		const file = torrent.files[0]; // there's only one file in the torrent.
		res.sendSeekable(file);
	} catch (err) {
		res.status(500).send(err);
	}
});

app.get("/api/add/:hash", validateInfoHash, (req, res) => {
	client.add(req.params.hash, () => {
		res.status(200).send("Added torrent!");
		console.log("added torrent");
	});

	client.on("error", err => {
		res.status(500).send(err.toString());
	});
});

app.get("/api/delete/:hash", validateInfoHash, (req, res) => {
	console.log("destroying torrent");
	const torrent = client.get(req.params.hash);
	try {
		if (req.headers["keep-alive"] === "keep") {
			client.remove(torrent);
		} else {
			destroy(torrent);
		}
		res.status(200).send("Removed torrent");
	} catch (err) {
		res.status(500).send(err);
	}

});

// display the client info
app.get("/api/client", (req, res) => {
	const data = {
		"downSpeed": client.downloadSpeed,
		"upSpeed": client.uploadSpeed,
		"totalProgress": client.progress,
		"torrents": client.torrents.map(torrent => ({
			"name": torrent.name,
			"infoHash": torrent.infoHash,
			"remaining": torrent.timeRemaining,
			"downloaded": torrent.downloaded,
			"downSpeed": torrent.downloadSpeed,
			"upSpeed": torrent.uploadSpeed,
			"progress": torrent.progress,
		})),
	};
	res.send(data);
});

app.listen(3000, () => console.log("server started on port 3000"));
