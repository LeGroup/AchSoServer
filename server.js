var express=require("express")
var app=express()

app.get("/", function(req, res, next)
{
	res.type("text/plain");
	res.send("hello world");
});

app.listen(9999);
console.log("Server started");
