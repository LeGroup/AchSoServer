var express=require("express"),
	format=require("util").format,
	mongoose=require("mongoose"),
	fs=require("fs");
var app=express()

app.use(express.bodyParser()) // For parsing multipart form data

app.get("/", function(req, res, next)
{
	res.type("text/plain");
	res.send("hello world");
});

mongoose.connect("mongodb://127.0.0.1/mongodb")
var db=mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB error:"));
db.once("open", main);

function main()
{
	var schema=mongoose.Schema({
		title: String,
		video: Buffer,
		created_at: Date
		//genre: String
	});
	var SemanticVideo=mongoose.model("SemanticVideo", schema);
	console.log("Database ok");

	app.get("/upload", function(req, res, next)
	{// For debugging
		res.send("<form method='post' enctype='multipart/form-data'><input type='file' name='video'/>"
				+"<input type='submit' value='upload'/></form>");
	});

	app.post("/upload", function(req, res, next)
	{
		var video=new SemanticVideo({
			title: req.files.video.name,
			video: (function() {
				console.log("Reading file...");
				var buf=fs.readFileSync(req.files.video.path, {encoding: null});
				fs.unlinkSync(req.files.video.path);
				return buf;
			})(),
			created_at: Date.now()
			//genre: req.files.video.genre
		});
		console.log("Adding new video to database:\nTitle: " + video.title + "\nGenre: " + video.genre);
		video.save();
		res.send(format("\n uploaded %s (%d Kb) to %s"
			, req.files.video.name
			, req.files.video.size / 1024 | 0
			, req.files.video.path));
		console.log(req.files.video.name + " " + req.files.video.size + " " + req.files.video.path);
	});

	app.listen(9999);
	console.log("Server started");
};
