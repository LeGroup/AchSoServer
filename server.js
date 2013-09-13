var express=require("express"),
	format=require("util").format;
var app=express()
app.use(express.bodyParser()) // For parsing multipart form data

app.get("/", function(req, res, next)
{
	res.type("text/plain");
	res.send("hello world");
});

app.get("/upload", function(req, res, next)
{// For debugging
	res.send("<form method='post' enctype='multipart/form-data'><input type='file' name='video'/>"
		    +"<input type='submit' value='upload'/></form>");
});

app.post("/upload", function(req, res, next)
{
	res.send(format("\n uploaded %s (%d Kb) to %s"
		, req.files.video.name
		, req.files.video.size / 1024 | 0
		, req.files.video.path));
	console.log(req.files.video.name + " " + req.files.video.size + " " + req.files.video.path);
});

app.listen(9999);
console.log("Server started");
