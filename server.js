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
var BAD_DATA = 400; 
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
		communities: {type: [String], index: true},
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

	/* 
	get_videos_in_community
	    Return metadata of videos in community. User must be a member in community to get listing 
	    Request: GET
	    URL: http://???/get_videos_in_community
	    What is sent:
	        community_id:"xx":String,
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 
	    What is received:
	        JSON list of semantic video object
	*/
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
		} else {
			res.send(OK, []);
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

	/* 
	get_videos
	    General interface for receiving list of videos that fill given conditions. 
	    For searches, searches should also look into annotations and return videos that include matching annotations.
	    Even if community is empty, results should be filtered by those communities that the user can see.
	    Recommended for: 

	    
	    Request: GET
	    URL: http://???/get_videos
	    What is sent:
	        keywords may include subset of following:
	        search:"searchstring":String,
	        by_user:"username":String,
	        community: "community_key":String,
	        genre: "genre_id":String,
	        batch_size: 30(default):Number,
	        result_page: 1(default):Number,
	        sort_by:"date"(default)|"most_views", 
	        sort_order:(default)descending|ascending


	        name:"community_name":String, 
	        listed:true|false|1|0:Boolean, 
	        open:true|false|1|0:Boolean,
	        moderators:[user_id,]<String> 
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        unique id of community, or empty if it already exists
	*/
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

	/* 
	get_unique_id
	    Returns a new unique id. Semantic video can safely use this as an identifier and this identifier is used as a key to retrieve video metadata and annotations, and to retrieve the state of the video encoding process. 
	    Request: GET
	    What is sent: nothing
	    headers:
	        "X-auth-token":$token
	    returns:
	        200: unique id string, e.g: e0c3da80-e4cc-11e3-890e-5f6eb36c1ac9

	*/
	app.get("/api/get_unique_id", function(req, res) {
		console.log("Asking for a new key");
		var key = uuid.v1();
		console.log("-> "+ key);
		res.send(OK, key);
	});


	/*
	upload_video_metadata
	    This is used to upload annotations and metadata for video. This is done before sending the actual video file, but the video uri and thumb uri have placeholders instead of actual values. When upload_video is completed, Ach so! polls server with get_processing_state until it receives 'finished' state as response, and then does update_metadata with new uri values.

	    Ach saves to its local preferences when unfinished video processing polling is activated, so that it can continue and finalize the video metadata next time Ach so is launched, in case that the Ach so is shut down while the processing in server side is still going on.   

	    Communities is a list of community uids/keys. Usually adding and removing video to/from community is done through community api methods, but it is here for convenience, so that video can be created and shared with one call. 

	    Request: POST.
	    URL: http://???/upload_video_metadata
	    What is sent: "data" as UTF-8 StringEntity. 
	    headers: 
	        "X-auth-token":$token 
	        "Content-type":"application/json" 
	        "Accept":"application/json" 

	        data is json-representation of SemanticVideo:
	        SemanticVideo = json_object({
	            title: String,
	            creator: String,
	            qr_code: String,
	            created_at: Number,
	            video_uri: String,
	            genre: String,
	            key: String,
	            latitude: Number,
	            longitude: Number,
	            accuracy: Number,
	            duration: Number,
	            thumb_uri: String,
	            communities: String[],
	            annotations: Annotation[]
	            })

	        where each Annotation = {
	            creator: String,
	            start_time: Number,
	            position_x: Number,
	            position_y: Number,
	            text: String,
	            scale: Number,
	            key: String
	        }

	        In server side annotations should be saved as individual objects that have a reference to semantic video they belong to. It is easier to avoid conflicts when updating annotations. Annotation keys have form 'A{$random-prefix}-$video_key'.

	    What is received: 
	        200: Success.
	        404: URL not found.
	        401: Unauthorized.
	        500: Server Error.

	    example:

	        json = "{
	            'title': '1st video of Friday',
	            'creator': 'Jukka',
	            'qr_code': 'http://learning-layers.eu/',
	            'created_at': 1399550703652,
	            'video_uri': '',
	            'genre': 'Good work',
	            'key': 'ea901369-3ae0-42c6-aece-41151e474472',
	            'latitude': null,
	            'longitude': null,
	            'accuracy': null,
	            'duration': 324993,
	            'thumb_uri': '',
	            'communities': ['public'],
	            'annotations': [
	                {
	                'creator': 'Jukka',
	                'start_time': 12003,
	                'position_x': 0.33,
	                'position_y': 0.7,
	                'scale': 1.2,
	                'text': 'I made a scratch here.',
	                'key': 'A2f-ea901369-3ae0-42c6-aece-41151e474472'
	                },
	                {
	                'creator': 'Jukka',
	                'start_time': 22003,
	                'position_x': 0.63,
	                'position_y': 0.12,
	                'scale': 1.0,
	                'text': 'Good seam.',
	                'key': 'A36-ea901369-3ae0-42c6-aece-41151e474472'
	                }
	            ]

	        }";

	        HttpPost httppost = new HttpPost("http://merian.informatik.rwth-aachen.de:5080/AchSoServer/rest/upload_video_metadata");        
	        httppost.setHeader("X-auth-token", "04ef789a010c6f252a9f572347cac345");
	        httppost.setHeader("Content-type", "application/json");
	        httppost.setHeader("Accept":"application/json");
	        StringEntity se = new StringEntity(json, "UTF-8");
	        httppost.setEntity(se);
	        ...
	        httpclient.execute(httppost);
	        ...

	*/
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

	/*
	update_video_metadata
	    Update some of the fields of the video -- those that are included in the sent json object (excluding 'key', it cannot be changed, it is used to find what video to change.). It is otherwise similar to upload_metadata. Annotations are not updated through this, they use 
	    update_annotation or upload_annotation, with a video_key to link them to this video.
	     
	    Request: POST.
	    URL: http://???/update_video_metadata
	    What is sent: "data" as UTF-8 StringEntity. 
	    headers: 
	        "X-auth-token":$token 
	        "Content-type":"application/json" 
	        "Accept":"application/json" 

	        data is partial json-representation of SemanticVideo:
	        {
	            key: String, **rest are optional: **
	            title: String,
	            creator: String,
	            qr_code: String,
	            created_at: Number,
	            video_uri: String,
	            genre: String,
	            key: String,
	            latitude: Number,
	            longitude: Number,
	            accuracy: Number,
	            duration: Number,
	            thumb_uri: String
	        }

	    What is received: 
	        200: Success.
	        404: URL not found.
	        401: Unauthorized.
	        500: Server Error.

	    example:
	        json = "{
	            'key': 'ea901369-3ae0-42c6-aece-41151e474472',
	            'video_uri': 'http://tosini.informatik.rwth-aachen.de:8134/videos/ea901369-3ae0-42c6-aece-41151e474472.mp4',
	            'thumb_uri': 'http://tosini.informatik.rwth-aachen.de:8134/thumbnails/ea901369-3ae0-42c6-aece-41151e474472.jpg',
	        }";

	        HttpPost httppost = new HttpPost("http://merian.informatik.rwth-aachen.de:5080/AchSoServer/rest/upload_video_metadata");        
	        httppost.setHeader("X-auth-token", "04ef789a010c6f252a9f572347cac345");
	        httppost.setHeader("Content-type", "application/json");
	        httppost.setHeader("Accept":"application/json");
	        StringEntity se = new StringEntity(json, "UTF-8");
	        httppost.setEntity(se);
	        ...
	        httpclient.execute(httppost);
	        ...

	*/
	app.post("/api/update_video_metadata", function(req, res) {
		console.log("Update SemanticVideo");
		if(req.is("application/json"))
		{
			var data = req.body
			console.log(data);
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
			if (data.communities != null) {
				update_obj.communities = data.communities;
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

	/*
	upload_annotation
	    This is used to upload new annotation for existing video. 

	    Request: POST.
	    URL: http://???/upload_annotation
	    What is sent: "data" as UTF-8 StringEntity. 
	    headers: 
	        "X-auth-token":$token 
	        "Content-type":"application/json" 
	        "Accept":"application/json" 

	        data is a json-representation of Annotation:

	        Annotation = {
	            creator: String,
	            start_time: Number,
	            position_x: Number,
	            position_y: Number,
	            text: String,
	            scale: Number,
	            key: String,
	            video_key: String,
	        }

	        Annotation keys have form 'A{$random-prefix}-$video_key'.

	    What is received: 
	        200: Success.
	        404: URL not found.
	        401: Unauthorized.
	        500: Server Error.

	    example:

	        json = "{
	                'creator': 'Jukka',
	                'start_time': 12003,
	                'position_x': 0.33,
	                'position_y': 0.7,
	                'scale': 1.2,
	                'text': 'I made a scratch here.',
	                'key': 'A2f-ea901369-3ae0-42c6-aece-41151e474472',
	                'video_key': 'ea901369-3ae0-42c6-aece-41151e474472'
	        }";

	        HttpPost httppost = new HttpPost("http://merian.informatik.rwth-aachen.de:5080/AchSoServer/rest/upload_annotation");        
	        httppost.setHeader("X-auth-token", "04ef789a010c6f252a9f572347cac345");
	        httppost.setHeader("Content-type", "application/json");
	        httppost.setHeader("Accept":"application/json");
	        StringEntity se = new StringEntity(json, "UTF-8");
	        httppost.setEntity(se);
	        ...
	        httpclient.execute(httppost);
	        ...

	*/
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

	/*
	update_annotation
	    This is used to update attributes of existing annotation. Attributes are given as JSON object, and it needs only to include those fields that have changed.

	    Request: POST.
	    URL: http://???/update_annotation
	    What is sent: "data" as UTF-8 StringEntity. 
	    headers: 
	        "X-auth-token":$token 
	        "Content-type":"application/json" 
	        "Accept":"application/json" 

	        data is a json-representation of Annotation:

	        Annotation = {
	            key: String, *** Rest are optional: ***
	            creator: String,
	            start_time: Number,
	            position_x: Number,
	            position_y: Number,
	            text: String,
	            scale: Number,
	        }

	    What is received: 
	        200: Success.
	        404: URL not found.
	        401: Unauthorized.
	        500: Server Error.

	    example:

	        json = "{
	                'key': 'A2f-ea901369-3ae0-42c6-aece-41151e474472',
	                'position_x': 0.6,
	                'position_y': 0.2
	        }";

	        HttpPost httppost = new HttpPost("http://merian.informatik.rwth-aachen.de:5080/AchSoServer/rest/upload_annotation");        
	        httppost.setHeader("X-auth-token", "04ef789a010c6f252a9f572347cac345");
	        httppost.setHeader("Content-type", "application/json");
	        httppost.setHeader("Accept":"application/json");
	        StringEntity se = new StringEntity(json, "UTF-8");
	        httppost.setEntity(se);
	        ...
	        httpclient.execute(httppost);
	        ...
	*/
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

	/* 
	get_annotations
	    List of annotations for given video_key 
	    Request: GET
	    URL: http://???/get_annotations
	    What is sent: 
	        video_key:String  
	    headers: 
	        "X-auth-token":$token 
	    What is received:
	        JSON list of annotation objects, not ordered in any meaningful way
	*/
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

	/*
	add_community
	    Create a community that has access to videos 
	    Request: POST.
	    URL: http://???/add_community
	    What is sent: 
	        JSON object, where:  
	        name:"name":String, 
	        listed:true|false|1|0:Boolean, 
	        open:true|false|1|0:Boolean,
	        moderators:[user_id,]:<String> 
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        unique id of community, or empty if it already exists
	*/
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

	/*
	edit_community
	    Change community settings, only by moderator 
	    Request: POST.
	    URL: http://???/edit_community
	    What is sent:
	        JSON object, where key is mandatory and others are optional:
	        key:"stringid":String,
	        name:"community_name":String, 
	        listed:true|false|1|0:Boolean, 
	        open:true|false|1|0:Boolean,
	        moderators:[user_id,]<String> 
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        unique id of community, or empty if it already exists
	*/
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

	/*
	join_community
	    Join user xx to a community. If closed community, this is done by authenticated user who is a moderator. Username for authenticated user is retrievable from X-auth-token?
	    
	    Request: POST.
	    URL: http://???/join_community
	    What is sent: 
	        name:"community_uid":String, 
	        user_id:"xx":String
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        "success" or "not allowed"
	*/
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

	/*
	leave_community
	    Leave from a community. User xx is removed from community. There should be checks that the X-auth-token points to same user xx or to a moderator?
	    
	    Request: POST.
	    URL: http://???/leave_community
	    What is sent: 
	        name:"community_uid":String, 
	        user_id:"xx":String
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        "success" or "not allowed"
	*/
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

	/*
	get_communities
	    Return a list of listable communities (no arguments), or list of provided user_id:s communities. List is a json object 
	    Request: GET
	    URL: http://???/get_communities
	    What is sent: 
	        user_id:"xx":String (optional)
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        [{name:String, key:String, open:Boolean, listed:Boolean, is_member:Boolean, is_moderator},... ]
	        notice that if user_id is not given, is_member and is_moderator can default to false.
	*/
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

	/*
	add_video_to_community
	    Add a video to belong for a community. It is then visible for community members Requires video_key and community_id as arguments. 
	    Request: POST.
	    URL: http://???/add_video_to_community
	    What is sent: 
	        name:"community_id":String, 
	        video_key:"xx":String
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        "success" or "not allowed"

	*/
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
				res.send(SERVER_ERROR, "Adding failed, community not found");
				return;						
			}
			if (community.videos.indexOf(video_key) == -1) {
				community.videos.push(video_id);
				community.save();
			} else {
				console.log("Already a member");				
			}
			Video.findOne({key:video_key}, function (err, video) {
				if (err!=null) {
					console.log(err);
					res.send(SERVER_ERROR, "Adding failed, video not found");
					return;
				}
				if (video.communities.indexOf(community_id) == -1) {
					video.communities.push(community_id);
					video.save();
					res.send(OK, 'ok');					
				} else {
					res.send(OK, 'community already listed for video');		
				}
				return;
			});				
		});
	});

	/* 
	remove_video_from_community
	    Video is no longer listed as belonging to a community. Requires video_key and community_id as arguments. 
	    Request: POST.
	    URL: http://???/remove_video_from_community
	    What is sent: 
	        name:"community_id":String, 
	        video_key:"xx":String
	    headers: 
	        "X-auth-token":$token 
	        "Accept":"application/json" 

	    What is received:
	        "success" or "not allowed"
	*/
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
				console.log("Video not in community");
			} else {
				community.videos.splice(i, 1);
				community.save();
			}				
			Video.findOne({key:video_key}, function (err, video) {
				if (err!=null) {
					console.log(err);
					res.send(SERVER_ERROR, "Adding failed, video not found");
					return;
				}
				i = video.communities.indexOf(community_id);
				if (i == -1) {
					res.send(OK, 'community already removed from video');							
				} else {
					video.communities.splice(i, 1);
					video.save();
					res.send(OK, 'ok');				
				}
				return;
			});				

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

		query = SemanticVideo.find(query_params).sort(sort).skip(page*size).limit(size).lean(true);
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
		if (data.annotataions != null) {
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
