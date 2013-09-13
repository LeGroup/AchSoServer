var http=require("http");
var url=require("url");

function start(route)
{
	function onRequest(request, response)
	{
		var path=url.parse(request.url).pathname;
		route(path);

		response.writeHead(200, {"Content-Type": "text/plain"});
		response.write("Hello");
		response.end();
	}
	http.createServer(onRequest).listen(9999);
}

exports.start=start;
