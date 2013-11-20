var express=require("express"),
	format=require("util").format,
	mongoose=require("mongoose"),
	fs=require("fs");
var app=express();

app.use(express.bodyParser()); // For parsing multipart form data

app.get("/", function(req, res, next)
{
	res.type("text/plain");
	res.send("hello world");
});

mongoose.connect("mongodb://127.0.0.1/mongodb");
var db=mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB error:"));
db.once("open", main);

function main()
{
	var schema=mongoose.Schema({
		xml: String,
		video: Buffer,
		created_at: Date
		//genre: String
	});
	var SemanticVideo=mongoose.model("SemanticVideo", schema);
	console.log("Database ok");

	app.post("/upload", function(req, res, next)
	{
		console.log(req);
		var video=new SemanticVideo({
			xml: req.files.video.xml,
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
		console.log(req.files.video.name + " " + req.files.video.size + " " + req.files.video.path);
	});

	app.listen(9999);
	console.log("Server started");
}
