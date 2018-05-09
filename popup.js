/*
 * Helper function to check if array contains a specific array
 */
Array.prototype.includesArray = function(value) {
    var hash = {};
    for (var i = 0; i < this.length; i++) {
        hash[this[i]] = i;
    }
    return hash.hasOwnProperty(value);
}

/*
 * Add route to storage if not present yet
 */
var addRoute = function(from, to) {
  chrome.storage.local.get('routes', function(result) {
    var routes = result.routes;
    if (!routes.includesArray([from, to])) {
      routes.push([from, to]);
      chrome.storage.local.set({routes: routes});
      location.reload();
    }
  });
}

/*
 * Check that stop with given name exists
 */
var stopExists = function(stop, stopError) {
  return $.ajax({
    url: "https://www.idsjmk.cz/SelectBusStop/SelectBusStop.asmx/SearchBusStop3",
    type: "POST",
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    data: JSON.stringify({
      query: stop,
      includeStopsNotInDb: true
    }),
    success: function(data) {
      var stops = data.d.map(x => x.FullName.toLowerCase());
      var found = stops.includes(stop.toLowerCase());

      if (found) {
        // OK, both stops exist, add them to storage
        $('#' + stopError).html('Zastávka nalezena');
        return true;
      }
      else {
        $('#' + stopError).html('Zastávka nenalezena');
        return false;
      }
    },
    error: function() {
      $('#' + stopError).html('Chyba serveru');
    }
  });
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
    // Show error messages if stop has not been found
    $('#fromError').html(fromFound ? '' : 'Zastávka nenalezena');
    $('#toError').html(toFound ? '' : 'Zastávka nenalezena');

    if (fromFound && toFound) {
      // Both stops exist, update saved routes and reload
      chrome.storage.local.get({'routes': []}, function(result) {
        var routes = result.routes;
        var defaultRoute = result.routes.length;
        if (!routes.includesArray([from, to])) {
          routes.push([from, to]);
          chrome.storage.local.set({
            routes: routes,
            defaultRoute: defaultRoute
          });
          location.reload();
        }
      });
    }
  });
}

/*
 * Find connection for given route and time and show them in popup window
 */
var showConnections = function(from, to, datetime) {
  // Construct full URL
  var date = datetime.format('D.M.YY');
  var time = datetime.format('H:mm');
  var query = {f: from, t: to, date: date, time: time};
  var url = 'https://www.idsjmk.cz/spojeni.aspx?' + $.param(query);

  // Find connections and show them
  $.ajax({
    url: url,
    context: document.body,
    success: function(response) {
      // Display found connections
      $('#connections').append($(response).find('#ConnectionLabel'));

      // Parse date and time of last connection from response
      var timeString = [
        $(response).find('th.left_w6p').last().text(),
        $(response).find('th.time_w6p').last().text()
      ].join(' ');

      // Convert the time to moment in Europe/Prague timezone
      var newTime = moment.tz(timeString, "D.M. H:mm", "Europe/Prague");
      // Add 1 minute to avoid duplicate results
      newTime.add(1, 'minutes');
      // When the new time is less than the old one, we have probably hit turn
      // of year, so the year needs to be incremented
      if (newTime < datetime) {
        newTime.add(1, 'years');
      }

      console.log(datetime.format() + ' >>> ' + newTime.format());

      // Show link to find more connections
      $('#showMore').html(
        $('<a/>').attr({href: '#', id: 'showMoreLink'}).html('Další spoje')
      );
      // Link handler
      $('#showMoreLink').click(function() {
        $('#showMore').html(
          $('<img/>').attr({src: 'images/loading-bar.gif'})
        );
        showConnections(from, to, newTime);
        return false;
      });

    },
    error: function() {
      $('#connections').html('Chyba serveru');
    }
  });
}

$(function() {
  // Set autocomplete for input fields
  $('#from').autocomplete({source: autocompleteSource});
  $('#to').autocomplete({source: autocompleteSource});

  // Form submit handler
  $('#addRouteForm').submit(submitHandler);

  // Load saved routes from local storage
  chrome.storage.local.get({'routes': [], 'defaultRoute': 0},
    function(result) {
      // Show placeholder when no routes available
      var showPlaceholder = true;

      for (var i = 0; i < result.routes.length; i++) {
        if (result.routes[i] == null) {
          // Deleted route, skip
          continue;
        }

        showPlaceholder = false;

        var [from, to] = result.routes[i];

        var route = $('<a/>')
          .attr({href: '#'})
          .addClass('setDefaultRoute')
          .data('number', i)
          .html(from + ' &raquo; ' + to);

        var deleteRoute = $('<a/>')
          .attr({href: '#'})
          .addClass('deleteRoute')
          .data('number', i)
          .html('&#x274c;')

        var routeBox = $('<div/>')
          .addClass('routeBox')
          .append(route)
          .append(deleteRoute);

        // Find nearest connections for default route
        if (i == result.defaultRoute) {
            // Highlight the default route
            routeBox.addClass('defaultRoute');

            // Get current date and time and format them for URL
            datetime = moment().tz('Europe/Prague');

            showConnections(from, to, datetime);
        }

        $('#routes').append(routeBox);
      }

      if (showPlaceholder) {
        $('#connections').addClass('placeholder');
      }
      else {
        $('#connections').removeClass('placeholder');
      }

      // Change default route and reload when a link is clicked
      $('a.setDefaultRoute').click(function() {
        chrome.storage.local.set({defaultRoute: $(this).data('number')});
        location.reload();
      });

      // Delete route when a delete link is clicked
      $('a.deleteRoute').click(function() {
        var routeNumber = $(this).data('number');
        delete result.routes[routeNumber];
        chrome.storage.local.set({routes: result.routes});
        $(this).closest('div').remove();

        // Hide search results when default route is deleted
        if (routeNumber == result.defaultRoute) {
          $('#connections').empty();
          $('#connections').addClass('placeholder');
        }
      });
    }
  );
});
