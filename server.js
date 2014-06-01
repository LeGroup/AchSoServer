require("buffer");
var express=require("express"),
	format=require("util").format,
	mongoose=require("mongoose"),
	fs=require("fs"),
	libxml=require("libxmljs"),
	multiparty=require("multiparty"),
	url=require("url"),
	http=require("http");
	uuid=require("node-uuid");
var app=express();
var server=http.createServer(app);
require("buffer");

var OK = 200;
var UNAUTHORIZED = 401;
var PAGE_NOT_FOUND = 404;
var BAD_DATA = 405; // ??? fix this
var BAD_DATA_FORMAT = 406;
var SERVER_ERROR = 500;

app.use(express.urlencoded());
app.use(express.json());
app.use(express.bodyParser());

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
	var video_schema=mongoose.Schema({
		title: String,
		creator: {type: String, index: true},
		qr_code: String,
		created_at: Date,
		video_uri: String,
		genre: String,
		key: {type: String, index: true},
		location: { type: [Number], index: { type: '2dsphere', sparse: true }}, 
		duration: Number,
		thumb_uri: String,
		changed_at: {type: Date, index: true},
		communities: [String],
		last_version: Number // used to avoid conflicts when editing
	});

	var annotation_schema = mongoose.Schema({
		creator: String,
		start_time: Number,
		position_x: Number,
		position_y: Number,
		text: String,
		scale: Number,
		video_key: {type: String, index: true}
	});

	var community_schema = mongoose.Schema({
		moderators: [String], 
		members: [String],
		listed: Boolean,
		open: Boolean,
		name: String,
		key: {type: String, index: true}
	});

	// Let's try to keep user away from db, as it can esaily come from different source.
	// var user_schema = mongoose.Schema({
	// 	user_id: String,
	// 	email: String,
	// 	moderator: [String],
	// 	member: [String]
	// })

	var SemanticVideo=mongoose.model("SemanticVideo", video_schema);
	var Annotation = mongoose.model("Annotation", annotation_schema);
	var Community = mongoose.model("Community", community_schema);
	//var User = mongoose.model("User", user_schema);
	console.log("Database ok");


	// Video browsing and search methods  ////////////////////////////////////////////

	app.get("/api/get_videos_in_community", function(req, res) {
		console.log("Get videos in community");
		if (!is_valid_authentication(req, res)) return;
		// there should be a check here to verify that the authenticated has access to given community
		var community_id = req.query.community_id;
		if (community_id != null) {
			query = {'communities':community_id}; 
			video_search(res, query);
		}
	});

	app.get("/api/get_my_videos", function(req, res) {
		console.log("Get videos of this person");
		if (!is_valid_authentication(req, res)) return;
		var user_id = req.query.user_id;
		if (user_id != null) {
			query = {'creator':user_id}; 
			video_search(res, query);
		}
	});

	app.get("/api/get_videos_in_my_communities", function(req, res) {
		console.log("Get videos of this person's communities");
		if (!is_valid_authentication(req, res)) return;
		var user_id = req.query.user_id;
		if (user_id != null) {
			Community.find({'members':user_id}, 'key', function (err, community_keys) {
				if (err != null) {
					console.log(err);
					res.send(SERVER_ERROR, "Finding my communities failed, database error.");
					return;						
				}
				if (community_keys.length > 0) {
					query = {'community': {$in: community_keys}}; 
					video_search(res, query);					
				} else {
					res.send(OK, []);
				}

			});
		}
	});

	app.get("/api/get_video_by_id", function (req, res) {
		console.log("get_video_by_id, "+ req.query.id);
		SemanticVideo.findOne({key:req.query.id}, function (err, semvideo) {
			if (err != null) {
				console.log(err);
			}
			if (semvideo == null) {
				console.log("Key doesn't exist.");
				res.send("");				
			} else {
				console.log("Found video with key, looking for annotations");
				Annotation.find({video_key:req.query.id}, function (err, annotations) {
					if (err != null) {
						console.log(err);
					}
					semvideo.annotations = [];
					for (var i=0; i<annotations.length; i++) {
						semvideo.annotations.push(annotations[i]);
					}
					res.send(OK, semvideo.toJSON())
				});
			}
		});
	});


	app.get("/api/get_videos", function (req, res) {

	});

	app.get("/api/search", function(req, res)
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
				res.send(OK, json);
			});
		}
		else
		{
			var obj={searchResult: []};
			var json=JSON.stringify(obj);
			res.type("application/json");
			res.send(OK, json);
		}
	});

	// Upload / edit videos  ////////////////////////////////////////////

	app.get("/api/get_unique_id", function(req, res) {
		console.log("Asking for a new key");
		var key = uuid.v1();
		console.log("-> "+ key);
		res.send(OK, key);
	});


	app.post("/api/upload_video_metadata", function(req, res, next)
	{
		console.log("Upload SemanticVideo");
		if(req.is("application/json"))
		{
			var data = req.body
			console.log(data);
			// first we should check if there is semantic object with same key.
			// if such exists, update it with new values.
			// if not, then we create new object.
			SemanticVideo.findOne({key:data.key}, function (err, result) {
				if (result == null) {
					console.log("Key doesn't exist, creating new video.");
					create_new_video_from_data(data);				
				} else {
					console.log("Key exists already. Update video or cancel?");
				}
			});
			res.send(OK, "OK");
		}
	});

	app.post("/api/update_video_metadata", function(req, res) {
		console.log("Update SemanticVideo");
		if(req.is("application/json"))
		{
			var data = req.body
			console.log(data);
			// first we should check if there is semantic object with same key.
			// if such exists, update it with new values.
			// if not, then we create new object.
			var update_obj = {};
			var do_update = false;
			if (data.title != null) {
				update_obj.title = data.title;
				do_update = true;
			}
			if (data.qr_code != null) {
				update_obj.qr_code = data.qr_code;
				do_update = true;
			}
			if (data.created_at != null) {
				update_obj.created_at = data.created_at;
				do_update = true;
			}
			if (data.video_uri != null) {
				update_obj.video_uri = data.video_uri;
				do_update = true;
			}
			if (data.genre != null) {
				update_obj.genre = data.genre;
				do_update = true;
			}
			if (data.duration != null) {
				update_obj.duration = data.duration;
				do_update = true;
			}
			if (data.thumb_uri != null) {
				update_obj.thumb_uri = data.thumb_uri;
				do_update = true;
			}
			if (data.latitude != null && data.longitude != null) {
				update_obj.location = [data.longitude, data.latitude];
				do_update = true;
			}
			if (data.key == null) {
				do_update = false;
			}
			if (do_update) {
				update_obj.changed_at = new Date().getTime();
				SemanticVideo.findOneAndUpdate({key:data.key}, update_obj, function (err, result) {
					if (err != null) {
						console.log(err);
						res.send(SERVER_ERROR, "Update failed, internal error");
						return;
					}
					res.send(OK, "Ok");
				});
			} else {
				res.send(OK, "Nothing to update.");
			}
		}
	});


	// Upload/edit annotations  ////////////////////////////////////////////


	app.post("/api/upload_annotation", function(req, res) {
		console.log("Upload Annotation");
		if(req.is("application/json"))
		{
			var data = req.body
			console.log(data);
			var update_obj = {};
			if (data.video_key != null) {
				annotation = new Annotation({
					creator: data.creator,
					start_time: data.start_time,
					position_x: data.position_x,
					position_y: data.position_y,
					text: data.text,
					scale: data.scale,
					video_key: data.key
				});
				annotation.save();
				res.send(OK, "Ok");
			} else {
				res.send(OK, "Not enough data, no annotation created.");
			}
		}
	});

	app.post("/api/update_annotation", function(req, res) {
		console.log("Update Annotation");
		if(req.is("application/json"))
		{
			var data = req.body
			console.log(data);
			var update_obj = {};
			var do_update = false;
			if (data.creator != null) {
				update_obj.creator = data.creator;
				do_update = true;
			}
			if (data.start_time != null) {
				update_obj.start_time = data.start_time;
				do_update = true;
			}
			if (data.position_x != null) {
				update_obj.position_x = data.position_x;
				do_update = true;
			}
			if (data.position_y != null) {
				update_obj.position_y = data.position_y;
				do_update = true;
			}
			if (data.text != null) {
				update_obj.text = data.text;
				do_update = true;
			}
			if (data.scale != null) {
				update_obj.scale = data.scale;
				do_update = true;
			}
			if (data.key == null) {
				do_update = false;
			}
			if (do_update) {
				update_obj.changed_at = new Date().getTime();
				Annotation.findOneAndUpdate({key:data.key}, update_obj, function (err, result) {
					if (err != null) {
						console.log(err);
						res.send(SERVER_ERROR, "Update failed, internal error");
						return;
					}
					res.send(OK, "Ok");
				});
			} else {
				res.send(OK, "Nothing to update.");
			}
		}
	});

	app.get("/api/get_annotations", function(req, res) {
		console.log("Get annotations");
		if (!is_valid_authentication(req, res)) return;
		var video_key = req.query.video_key;
		if (video_key != null) {
			Annotation.find({video_key:req.query.video_key}).lean().exec(function (err, results) {
				if (err != null) {
					console.log(err);
					res.send(SERVER_ERROR, "Error querying annotations");
					return;
				}
				res.send(OK, JSON.stringify(results));
			});			
		} else {
			res.send(OK, "");
		}
	});


	// Community operations  ////////////////////////////////////////////

	app.post("/api/add_community", function(req, res) {
		console.log("Add community");
		if (!is_valid_authentication(req, res)) return;
		if(req.is("application/json")) {
			var data = req.body;
			console.log(data);
			// first we should check if there is a community with same name.
			Community.findOne({name:data.name}, function (err, result) {
				if (result == null) {
					console.log("Name doesn't exist, creating new community.");
					// parse rest of the json, or use defaults
					var moderator, members, listed, open, name, key, fail
					fail = false;
					if (!data.moderators || data.moderators.length == 0) {
						fail = true;			
					} else {
						moderators = data.moderators;
						members = data.moderators;
					}
					if (data.listed != null) {
						listed = data.listed;
					} else {
						listed = true;
					}
					if (data.open != null) {
						open = data.open;
					} else {
						open = true;
					}
					if (!data.name || data.name.length == 0) {
						fail = true;
					} else {
						name = data.name;
					}
					if (fail) {
						res.send(BAD_DATA, "Missing data");
						return;
					}
					key = uuid.v1();
					console.log("-> "+ key);

					community = new Community({
						moderators: moderators, 
						members: members,
						listed: listed,
						open: open,
						name: name,
						key: key			
					});
					community.save();
					res.send(OK, key);
					return;

				} else {
					console.log("Key exists already.");
					res.send(OK, "exists already");
					return;
				}
			});
		} else {
			res.send(BAD_DATA_FORMAT, "Not accepted");
			return;
		}
	});

	app.post("/api/edit_community", function(req, res) {
		console.log("Edit community");
		if (!is_valid_authentication(req, res)) return;
		if(req.is("application/json")) {
			var data = req.body
			// (validate and) build changes-object  
			obj = {}
			if (data.key == null) {
				res.send(BAD_DATA, "Missing required fields");
				return;
			}
			if (data.moderators && data.moderators.length > 0) {
				obj.moderators = data.moderators;			
			} 
			if (data.members && data.members.length > 0) {
				obj.members = data.members;			
			} 
			if (data.listed != null) {
				obj.listed = data.listed;
			} 
			if (data.open != null) {
				obj.open = data.open;
			}
			if (data.name && data.name.length > 0) {
				obj.name = data.name;
			}
			if (Object.keys(obj).length > 0) {
				Community.update({key:data.key}, obj, {}, function (err, result) {
					if (err != null) {
						console.log(err);
						res.send(SERVER_ERROR, "Update failed");
						return;						
					}
					res.send(OK, "Ok");
					return;
				} );
			} else {
				res.send(BAD_DATA, "Missing required fields (obj size zero)");
				return;
			}
		} else {
			res.send(BAD_DATA_FORMAT, "Not accepted");
			return;
		}
	});

	app.post("/api/join_community", function(req, res) {
		console.log("Join community");
		if (!is_valid_authentication(req, res)) return;
		var community_id = req.body.community_id;
		var user_id = req.body.user_id;
		if (community_id == null || user_id == null) {
			console.log(community_id)
			console.log(user_id)
			res.send(BAD_DATA, "Missing required fields");
			return;
		}
		Community.findOne({key:community_id}, function (err, community) {
			if (err!=null) {
				console.log(err);
				res.send(SERVER_ERROR, "Joining failed, community not found");
				return;						
			}
			if (community.members.indexOf(user_id) == -1) {
				community.members.push(user_id);
				community.save();
				res.send(OK, "OK");
				return;
			} else {
				res.send(OK, "Already a member");
				return;				
			}				
		});
	});

	app.post("/api/leave_community", function(req, res) {
		console.log("Leave community");
		if (!is_valid_authentication(req, res)) return;
		var community_id = req.body.community_id;
		var user_id = req.body.user_id;
		if (community_id == null || user_id == null) {
			console.log(community_id)
			console.log(user_id)
			res.send(BAD_DATA, "Missing required fields");
			return;
		}
		Community.findOne({key:community_id}, function (err, community) {
			if (err!=null) {
				console.log(err);
				res.send(SERVER_ERROR, "Joining failed, community not found");
				return;						
			}
			var i = community.members.indexOf(user_id);
			if (i == -1) {
				res.send(OK, "Not a member");
				return;				
			} else {
				community.members.splice(i, 1);
				i = community.moderators.indexOf(user_id);				
				if (i != -1 && community.moderators.length > 1) { // last moderator cannot leave
					community.moderators.splice(i, 1);
				}
				community.save();
				res.send(OK, "OK");
				return;
			}				
		});
	});

	app.get("/api/get_communities", function(req, res) {
		console.log("Get communities");
		if (!is_valid_authentication(req, res)) return;
		var user_id = req.query.user_id;
		if (user_id != null) {
			// list my communities
			console.log("Find communities for " + user_id);
			query = Community.find({'members':user_id});
		} else {
			// list all public communities
			console.log("Find listed communities");
			query = Community.find({'listed':true});
		}
		query.sort('+name');
		query.exec(function (err, results) {
			if (err!=null) {
				console.log(err);
				res.send(SERVER_ERROR, "Get communities failed, database error.");
				return;						
			}
			console.log(results);
			res.send(OK, JSON.stringify(results));
		});
	});

	app.post("/api/add_video_to_community", function(req, res) {
		console.log("Add video to community");
		if (!is_valid_authentication(req, res)) return;
		var community_id = req.body.community_id;
		var video_key = req.body.video_key;
		if (community_id == null || video_key == null) {
			console.log(community_id)
			console.log(video_key)
			res.send(BAD_DATA, "Missing required fields");
			return;
		}
		Community.findOne({key:community_id}, function (err, community) {
			if (err!=null) {
				console.log(err);
				res.send(SERVER_ERROR, "Joining failed, community not found");
				return;						
			}
			if (community.videos.indexOf(video_key) == -1) {
				community.videos.push(video_id);
				community.save();
				res.send(OK, "OK");
				return;
			} else {
				res.send(OK, "Already a member");
				return;				
			}				
		});
	});

	app.post("/api/remove_video_from_community", function(req, res) {
		console.log("Remove video from community");
		if (!is_valid_authentication(req, res)) return;
		var community_id = req.body.community_id;
		var video_key = req.body.video_key;
		if (community_id == null || video_key == null) {
			console.log(community_id)
			console.log(video_key)
			res.send(BAD_DATA, "Missing required fields");
			return;
		}
		Community.findOne({key:community_id}, function (err, community) {
			if (err!=null) {
				console.log(err);
				res.send(SERVER_ERROR, "Adding video failed, community not found");
				return;						
			}
			var i = community.videos.indexOf(video_key);
			if (i == -1) {
				res.send(OK, "Video not in community");
				return;				
			} else {
				community.videos.splice(i, 1);
				community.save();
				res.send(OK, "OK");
				return;
			}				
		});
	});


	// other  ////////////////////////////////////////////

	app.get("*", function(req, res)
	{
		var root="./static";
		if(fs.existsSync(root + req.params[0]))
		{
			res.sendfile(req.params[0], {root: root});
		}
		else res.send(PAGE_NOT_FOUND);
	});



	// Not used
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
			res.send(OK, "OK");
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
			res.writeHead(OK);
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
			res.writeHead(OK);
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
			res.json(OK, obj.annotations);
		});
	});



	server.listen(9999);
	console.log("Server started");

	// Helper functions  ////////////////////////////////////////////

	function video_search(res, query_params, psort, psize, ppage) {
		var sort = '+changed_at';
		var page = 0;
		var size = 20;
		if (psort != null) sort = psort;
		if (psize != null) size = psize;
		if (ppage != null) page = ppage;

		query = SemanticVideo.find(query_params).query.sort(sort).skip(page*size).limit(size).lean(true);
		query.exec(function (err, results) {
			if (err!=null) {
				console.log(err);
				res.send(SERVER_ERROR, "Search failed, database error.");
				return;						
			}
			console.log(results);
			res.send(OK, JSON.stringify(results));
		});

	}

	function is_valid_authentication(req, res) {
		// always return ok, later return 401 (UNAUTHORIZED) when necessary.
		if (false) {
			res.send(UNAUTHORIZED);
			return false;
		} else {
			return true;
		}
	}

	function create_new_video_from_data(data) {
		var annotation, adata, _id, location;
		for (var i=0; i< data.annotations.length; i++) {
			adata = data.annotations[i];
			annotation = new Annotation({
				creator: adata.creator,
				start_time: adata.start_time,
				position_x: adata.position_x,
				position_y: adata.position_y,
				text: adata.text,
				scale: adata.scale,
				video_key: data.key
			});
			annotation.save();
		} 

		if (data.latitude != null && data.longitude != null) {
			location = [data.longitude, data.latitude];
			// we are ignoring data.accuracy
		} else {
			location = null;
		}

		var video = new SemanticVideo({
			title: data.title,
			creator: data.creator,
			qr_code: data.qr_code,
			created_at: data.created_at,
			video_uri: data.video_uri,
			genre: data.genre,
			key: data.key,
			location: location,
			duration: data.duration,
			thumb_uri: data.thumb_uri,
			communities: data.communities,
			changed_at: new Date().getTime()
		});
		console.log("Adding new video to database:\nTitle: " + video.title + "\nGenre: " + video.genre);

		video.save();

		// Add video to communities if such are given. After this initial creation these things are done through community api
		if (data.communities != null) {
			for (var i=0; i<data.communities.length; i++) {
				c_id = data.communities[i];
				Community.findOne({key:c_id}, function (err, community) {
					if (err != null) {
						console.log(err);
					} else {
						if (community.videos.indexOf(video_key) == -1) {
							community.videos.push(video_id);
							community.save();
						}
					}
				});
			}
		}
	}
		// var video=new SemanticVideo({
		// 	json: json,
		// 	filename: files.video[0].path.split("/").pop(),
		// 	path: files.video[0].path,
		// 	created_at: Date.now(),
		// 	title: null,
		// 	genre: null,
		// 	creator: null
		// });

		// var xmld=new libxml.parseXml(video.xml);
		// video.title=xmld.get("title").text();
		// video.genre=xmld.get("genre").text();
		// video.creator=xmld.get("creator").text();

		// // Replace local video_uri with server's uri
		// var uri=url.format({
		// 	protocol: req.protocol,
		// 	hostname: req.host,
		// 	port: server.address().port,
		// 	pathname: "watch/" + video.filename
		// });
		// xmld.get("video_uri").text(uri);
		// video.xml=xmld.toString(false); // Do not format the xml output


	// not used
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
