var express=require("express")
var server=express()

server.get("/", function(request, response)
{
	response.type("text/plain");
	response.send("hello world");
});

server.listen(9999);
