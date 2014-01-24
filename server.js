require("buffer");
var express=require("express"),
	format=require("util").format,
	mongoose=require("mongoose"),
	fs=require("fs"),
	libxml=require("libxmljs"),
	multiparty=require("multiparty"),
	url=require("url"),
	http=require("http");
var app=express();
var server=http.createServer(app);
require("buffer");

app.use(express.urlencoded());
app.use(express.json());

app.get("/", function(req, res, next)
{
	res.type("text/plain");
	res.send("");
});

mongoose.connect("mongodb://127.0.0.1/achso");
var db=mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB error:"));
db.once("open", main);

function main()
{
	var schema=mongoose.Schema({
		xml: String,
		filename: String,
		path: String,
		created_at: Date,
		title: String,
		genre: String,
		creator: String
	});
	var SemanticVideo=mongoose.model("SemanticVideo", schema);
	console.log("Database ok");

	app.post("/upload", function(req, res, next)
	{
		console.log("Upload");
		if(req.is("multipart/form-data"))
		{
			var form=new multiparty.Form({
				uploadDir: "videos"
			});
			form.parse(req, function(err,fields,files)
			{
				parse_video_data(req,err,fields,files);
			});
			res.send("OK");
		}
	});

	app.get("/search", function(req, res)
	{
		if(req.query.title)
		{
			var jsonobj={searchResult: []};
			var ret=[];
			SemanticVideo.where("title").regex(new RegExp(req.query.title, "i")).exec(function(err, svs)
			{
				console.log("Search with title '" + req.query.title + "' hit " + svs.length + " videos.");
				for(var i=0, len=svs.length; i<len; ++i)
				{
					ret.push({
						xml: svs[i].xml
					});
				}
				jsonobj.searchResult=ret;
				var json=JSON.stringify(jsonobj);
				res.type("application/json");
				res.send(json);
			});
		}
		else
		{
			var obj={searchResult: []};
			var json=JSON.stringify(obj);
			res.type("application/json");
			res.send(json);
		}
	});

	app.get("/watch/:video", function(req, res)
	{
		var root="./videos/";
		if(fs.existsSync(root + req.params.video))
		{
			console.log("Playing video " + req.params.video);
			res.sendfile(req.params.video, {root: "./videos/"});
		}
		SemanticVideo.findById(req.params.video, function(err, video)
		{
			if(err) res.send(":(");
			else res.sendfile(video.path);
		});
	});

	app.get("/player", function(req, res)
	{
		SemanticVideo.find().exec(function(err, videos)
		{
			res.writeHead(200);
			res.write("<!DOCTYPE html><html><head></head><body>");
			res.write("<ul>");
			for(var i=0, len=videos.length; i<len; ++i)
			{
				res.write("<li><a href='/player/" + videos[i]._id + "'>" + videos[i].title + "</a></li>");
			}
			res.write("</ul></body>");
			res.end();
		});
	});

	app.get("/player/:video", function(req, res)
	{
		fs.readFile("static/player.html", "binary", function(err, file)
		{
			res.writeHead(200);
			res.write(file, "binary");
			res.end();
		});
	});

	app.get("/player/:videoid/annotations.json", function(req, res)
	{
		SemanticVideo.findById(req.params.videoid, function(err, video)
		{
			var xmld=libxml.parseXmlString(video.xml);
			var obj={};
			var children=xmld.root().childNodes();
			for(var i=0; i<children.length; ++i)
			{
				switch(children[i].name())
				{
					case "annotations":
					{
						obj["annotations"]=[];
						var subchildren=children[i].childNodes();
						for(var j=0; j<subchildren.length; ++j)
						{
							var subobj={};
							var subsubchildren=subchildren[j].childNodes();
							for(var k=0; k<subsubchildren.length; ++k)
							{
								subobj[subsubchildren[k].name()] = subsubchildren[k].text();
							}
							obj["annotations"].push(subobj);
						}
					}
					break;

					case "thumb_image": break;

					default:
						obj[children[i].name()] = children[i].text();
						break;
				}
			}
			res.json(200, obj.annotations);
		});
	});

	app.get("*", function(req, res)
	{
		var root="./static";
		if(fs.existsSync(root + req.params[0]))
		{
			res.sendfile(req.params[0], {root: root});
		}
		else res.send(404);
	});

	server.listen(9999);
	console.log("Server started");

	function parse_video_data(req, err, fields, files)
	{
		console.log(fields);
		var video=new SemanticVideo({
			xml: fields.xml[0],
			filename: files.video[0].path.split("/").pop(),
			path: files.video[0].path,
			created_at: Date.now(),
			title: null,
			genre: null,
			creator: null
		});

		var xmld=new libxml.parseXml(video.xml);
		video.title=xmld.get("title").text();
		video.genre=xmld.get("genre").text();
		video.creator=xmld.get("creator").text();

		// Replace local video_uri with server's uri
		var uri=url.format({
			protocol: req.protocol,
			hostname: req.host,
			port: server.address().port,
			pathname: "watch/" + video.filename
		});
		xmld.get("video_uri").text(uri);
		video.xml=xmld.toString(false); // Do not format the xml output

		console.log("Adding new video to database:\nTitle: " + video.title + "\nGenre: " + video.genre);
		video.save();
	}
}
