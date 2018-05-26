/*
 * Route class
 */
function Route(from, to) {
  this.from = from;
  this.to = to;
  this.views = 0;
}

/*
 * Helper function to test route equality
 */
Route.prototype.equals = function(other) {
  return (this.from == other.from && this.to == other.to);
}

/*
 * Autocomplete stop names
 */
var autocompleteSource = function(request, response) {
  $.ajax({
    url: "https://www.idsjmk.cz/SelectBusStop/SelectBusStop.asmx/SearchBusStop3",
    type: "POST",
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    data: JSON.stringify({
      query: request.term,
      includeStopsNotInDb: true
    }),
    success: function(data) {
      response(data.d.map(x => x.FullName).slice(0, 10));
    }
  });
}

/*
 * Form submit handler
 */
var submitHandler = function(event) {
  // Suppress form submit
  event.preventDefault();

  // Close autocomplete dropdowns
  $('#from').autocomplete('close');
  $('#to').autocomplete('close');

  var from = $('#from').val();
  var to = $('#to').val();

  var fromFound, toFound;

  $.when(
    // Validate `from` field
    $.ajax({
      url: "https://www.idsjmk.cz/SelectBusStop/SelectBusStop.asmx/SearchBusStop3",
      type: "POST",
      contentType: "application/json; charset=utf-8",
      dataType: "json",
      data: JSON.stringify({
        query: from,
        includeStopsNotInDb: true
      }),
      success: function(data) {
        var stops = data.d.map(x => x.FullName);
        var lowerCaseStops = stops.map(x => x.toLowerCase());
        fromFound = lowerCaseStops.includes(from.toLowerCase());
        from = stops[lowerCaseStops.indexOf(from.toLowerCase())];
      },
      error: function() {
        $('#fromError').html('Chyba serveru');
      }
    }),
    // Validate `to` field
    $.ajax({
      url: "https://www.idsjmk.cz/SelectBusStop/SelectBusStop.asmx/SearchBusStop3",
      type: "POST",
      contentType: "application/json; charset=utf-8",
      dataType: "json",
      data: JSON.stringify({
        query: to,
        includeStopsNotInDb: true
      }),
      success: function(data) {
        var stops = data.d.map(x => x.FullName);
        var lowerCaseStops = stops.map(x => x.toLowerCase());
        toFound = lowerCaseStops.includes(to.toLowerCase());
        to = stops[lowerCaseStops.indexOf(to.toLowerCase())];
      },
      error: function() {
        $('#toError').html('Chyba serveru');
      }
    })
  ).then(function() {
    if (fromFound && toFound) {
      // Both stops exist, update saved routes and reload
      var searchedRoute = new Route(from, to);
      updateStatsAndReload(searchedRoute);
    }
  });
}

/*
 * Update search statistics in browser storage and reload popup
 */
var updateStatsAndReload = function(route) {
  chrome.storage.local.get({'routes': []}, function(result) {
    var routes = result.routes;
    var routeFound = false;

    // Check if the searched route is among the saved routes
    for (var i = 0; i < routes.length; i++) {
      if (route.equals(routes[i])) {
        routeFound = true;
        route = routes[i];
        break;
      }
    }

    // Searched route not found in saved routes, add it
    if (!routeFound) {
      routes.push(route);
    }

    // Increment number of views for route
    route.views++;

    // Save updated routes to storage
    chrome.storage.local.set({
      routes: routes,
      defaultRoute: route
    });

    // Reload popup
    redraw();
  });
}

/*
 * Find connection for given route and time and show them in popup window
 */
var showConnections = function(from, to, date, time, lowdtr) {
  // Construct full URL
  var query = {f: from, t: to, date: date, time: time, lowdtr: lowdtr};
  var url = 'https://www.idsjmk.cz/spojeni.aspx?' + $.param(query);

  // Show loading bar
  $('#showMore').html(
    $('<img/>').attr({src: 'images/loading-bar.gif'})
  );

  // Find connections and show them
  $.ajax({
    url: url,
    context: document.body,
    success: function(response) {
      // Display found connections
      $('#connections').append($(response).find('#ConnectionLabel'));

      // Parse date and time of last connection from response
      var lastDate = $(response).find('th.left_w6p').last().text();
      var lastTime = $(response).find('th.time_w6p').last().text();

      // Failed to parse date and/or time, do not display search link
      if (lastDate == '' || lastTime == '') {
        $('#showMore').empty();
        return;
      }

      var datetime = moment.tz(`${date} ${time}`, 'D.M. H:mm', 'Europe/Prague');

      var timeString = [lastDate, lastTime].join(' ');

      // Convert the time to moment in Europe/Prague timezone
      var newDateTime = moment.tz(timeString, "D.M. H:mm", "Europe/Prague");
      // Add 1 minute to avoid duplicate results
      newDateTime.add(1, 'minutes');
      // When the new time is less than the old one, we have probably hit turn
      // of year, so the year needs to be incremented
      if (newDateTime < datetime) {
        newDateTime.add(1, 'years');
      }

      // Show link to find more connections
      $('#showMore').html(
        $('<a/>').attr({href: '#', id: 'showMoreLink'}).html('Další spoje')
      );
      // Link handler
      $('#showMoreLink').click(function() {
        var newDate = newDateTime.format('D.M.YY');
        var newTime = newDateTime.format('H:mm');
        showConnections(from, to, newDate, newTime, lowdtr);
        return false;
      });

    },
    error: function() {
      $('#showMore').html('Chyba serveru');
    }
  });
}

var redraw = function() {
  // Load saved routes from local storage
  chrome.storage.local.get({'routes': [], 'defaultRoute': null, 'lowdtr': 0},
    function(result) {
      // Set opacity of wheelchair icon
      $('#wheelchair').css('opacity', result.lowdtr ? 1 : 0.5);

      // Show default route in input fields and search for connection or show
      // placeholder when no default route available
      var defaultRoute = result.defaultRoute;
      if (defaultRoute) {
        $('#from').val(defaultRoute.from);
        $('#to').val(defaultRoute.to);
        $('#connections').empty();
        $('#connections').removeClass('placeholder');
        showConnections(
          defaultRoute.from,
          defaultRoute.to,
          $('#date').val(),
          $('#time').val(),
          result.lowdtr
        );
      }
      else {
        $('#showMore').empty();
        $('#connections').addClass('placeholder');
      }

      // Show six routes with most views
      $('#routes').empty();
      var routes = result.routes.sort((x, y) => x.views - y.views).slice(-6);
      for (let route of routes) {
        showPlaceholder = false;

        var routeLink = $('<a/>')
          .attr({href: '#'})
          .addClass('setDefaultRoute')
          .data('from', route.from)
          .data('to', route.to)
          .html(route.from + ' &raquo; ' + route.to);

        var routeBox = $('<div/>')
          .addClass('routeBox')
          .append(routeLink)

        // Find nearest connections for default route
        if (route.from == defaultRoute.from && route.to == defaultRoute.to) {
          // Highlight the default route and make it unclickable
          routeBox.addClass('defaultRoute');
          routeLink.removeClass('setDefaultRoute');
          routeLink.removeAttr('href');
        }

        $('#routes').append(routeBox);
        $('#routes').css('padding', '5px');
      }

      // Change default route and reload when a link is clicked
      $('a.setDefaultRoute').click(function() {
        var defaultRoute = new Route($(this).data('from'), $(this).data('to'));
        chrome.storage.local.set({defaultRoute: defaultRoute});
        redraw();
      });

    }
  );
}

/*
 * From-to swap handler
 */
var swapHandler = function() {
  var newRoute = new Route($('#to').val(), $('#from').val());
  chrome.storage.local.set({defaultRoute: newRoute});
  updateStatsAndReload(newRoute);
}

/*
 * Low-floor switch handler
 */
var wheelchairHandler = function() {
  chrome.storage.local.get({'lowdtr': 0}, function(result) {
    chrome.storage.local.set({'lowdtr': 1 - result.lowdtr}, function() {
      $('#searchForm').submit();
    })
  });
}

$(function() {
  // Set autocomplete for input fields
  $('#from').autocomplete({
    source: autocompleteSource,
    select: function(event, ui) {
      $('#from').val(ui.item.label);
      $('#searchForm').submit();
    }
  });
  $('#to').autocomplete({
    source: autocompleteSource,
    select: function(event, ui) {
      $('#to').val(ui.item.label);
      $('#searchForm').submit();
    }
  });

  // Enable date picker widget
  $('#date').datepicker({dateFormat: 'd.m.y'});

  // Show current date and time in input fields
  var datetime = moment().tz('Europe/Prague');
  $('#time').val(datetime.format('H:mm'));
  $('#date').val(datetime.format('D.M.YY'));

  // Form submit handler
  $('#searchForm').submit(submitHandler);

  // From-to swap handler
  $('#swapFromTo').click(swapHandler);

  // Low-floor switch handler
  $('#wheelchair').click(wheelchairHandler);

  // Submit form whenever time or date is changed
  $('#time').change(submitHandler);
  $('#date').change(submitHandler);

  redraw();
});
