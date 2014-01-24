$(function()
{
	"use strict";
	var videoid=window.location.pathname.split('/').pop();
	$("#semanticvideo").append("<source type='video/mp4' src='" + "/watch/" + videoid + "'></source>");
	/*
	$("#semanticvideo").on("timeupdate", function(e)
	{
		console.log(e);
	});
	*/
	$.getJSON(window.location.pathname + "/annotations.json", function(annotations)
	{
		var audio_clock;
		var player;
		$("#semanticvideo").bind("timeupdate", onAudioUpdate);
		$("#semanticvideo").bind("play", function(){
			audio_clock = setInterval(function(){
				onAudioUpdate();
			}, 100);
		});
		$("#semanticvideo").bind("pause", function(){
			clearInterval(audio_clock);
		});
		function onAudioUpdate() {
			var curtime=player.currentTime()*1000;
			$("#subtitles").text("");
			for(var i=0, len=annotations.length; i<len; ++i)
			{
				var start=parseInt(annotations[i].start_time, 10);
				var end=start + parseInt(annotations[i].duration, 10);
				if(curtime > start && curtime < end)
				{
					annotations[i].dom.show();
					annotations[i].dom.css({
						left: $("#semanticvideo").outerWidth(true) * parseFloat(annotations[i].x_position) - (annotations[i].dom.outerWidth(true)/2),
						top:  $("#semanticvideo").outerHeight(true) * parseFloat(annotations[i].y_position) - (annotations[i].dom.outerHeight(true)/2)
					});
					$("#subtitles").text(annotations[i].text);
				} else annotations[i].dom.hide();
			}
		}
		player=videojs("semanticvideo", {width: "auto", height: "auto"}, function()
		{
			$("#semanticvideo").append("<p id='subtitles'/>");
			for(var i=0; i<annotations.length; ++i)
			{
				annotations[i]["dom"]=$("<div class='annotation'></div>");
				annotations[i].dom.hide().appendTo($("#semanticvideo"));
			}

			var myPlayer = this; // Store the video object
			var aspectRatio = 9/16; // Make up an aspect ratio
			function resizeVideoJS(){
				// Get the parent element's actual width
				var width = document.getElementById(myPlayer.id()).parentElement.offsetWidth;
				// // Set width to fill parent element, Set height
				myPlayer.width(width).height( width * aspectRatio );
			}
			resizeVideoJS(); // Initialize the function
			window.onresize = resizeVideoJS; // Call the function on resize 
			myPlayer.play();
			myPlayer.pause();
		});
	});
});
