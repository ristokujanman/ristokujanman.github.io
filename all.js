// shows menu

var isOverMenu = false;

$("#menu").mouseover(function(){
  if (!$('header').is(':hover') === true) {
  	console.log('ahahahhaa')
  }

  console.log('jhasgdjhasg')

  isOverMenu = true;

});

$("#menu").mouseout(function(){

  isOverMenu = false;

});

// scrolls to element

$("#menu li a").click(function() {
    console.log( $(this).attr("id") );

    var id = $(this).attr("id");
    $('html, body').animate({
        scrollTop: $("#" + id + "-content").offset().top
    }, 1000);
});


// get width of screen
var screenw = $( window ).width();

// calculate left and right area's where the mouse will change
var leftLimit = screenw * .35;				 	// 30 percent of the left side of the screen
var rightLimit = screenw - (screenw * .35); 		// 30 percent of the right part of the screen

// scroll the amount of a portfolio-item (image) including the margins
var scrollAmount = $('.portfolio-item').width() + 30;


$(".scrollsection").click(function( event ) {


  console.log('scrolling: ', screenw, scrollAmount);

  	// find out if the click was on the left or right side of the page
	if (event.pageX < leftLimit) {
		// left side
		  $(this).find('.scroller').animate({scrollLeft:'-=' + scrollAmount}, 300);
		  // $(window).animate({scrollTop: 0}, 300);

  	}
  	else if (event.pageX > rightLimit) {
		// right side
		  $(this).find('.scroller').animate({scrollLeft:'+=' + scrollAmount}, 300);
		  // $(window).animate({scrollTop: 0}, 300);
  	}
});


$("body").mousemove(function( event ) {
  	
  	// find out if the mouse is on the left or right side of the page
	if (event.pageY < $(document).height() - ($(document).height() / 7)) { 
	
		if (event.pageX < leftLimit) {

			// left side		
			// hide the cursor
			$('body').css('cursor', 'none');
			// show the left arrow  	

			if (!isOverMenu) {
				$('#arrow-left').show();
			}
			else   {
				 $('#arrow-left').hide();
			}

			// make the left arrow follow the mouse position
			$('#arrow-left').css({
			    'top' :  (event.pageY - $(".arrow").height() / 2) + 'px',
			    'left' : (event.pageX + 5) + 'px'
			});        
		}
		else if (event.pageX > rightLimit) {
			// right side
			// hide the cursor
			$('body').css('cursor', 'none');
			// show the right cursor
			$('#arrow-right').show();

			// make the right cursor follow the mouse
			$('#arrow-right').css({
				'top' :  (event.pageY - $(".arrow").height() / 2) + 'px',
				'left' : (event.pageX - $(".arrow").width()) + 'px'
			});
		}
		else {
			// hide the arrows
			$('#arrow-left').hide();
			$('#arrow-right').hide();

			// show the cursor
			$('body').css('cursor', 'default');
		}
	}
	else { 
		// hide the arrows
		$('#arrow-left').hide();
		$('#arrow-right').hide();

		// show the cursor
		$('body').css('cursor', 'default');
	}	
		
});



