/*   
  Road traffic simulator for exploring Braess's paradox.
  By Brian Hayes, 2015. MIT license.
  For more background see American Scientist July 2015.
*/

(function() {
  
  var xmlns = "http://www.w3.org/2000/svg";
  var frame = document.getElementById("the-coordinate-frame");
  
  
    // event handlers and pointers to DOM elements
  var snBridge = document.getElementById("sn-bridge");
  snBridge.addEventListener("click", toggleBridge, false);
  
  var nsBridge = document.getElementById("ns-bridge");
  nsBridge.addEventListener("click", toggleBridge, false);
  
  var theBarricade = document.getElementById("barricade");
  theBarricade.addEventListener("click", toggleBridge, false);
  
  var goButton = document.getElementById("the-run-button");
  goButton.addEventListener("click", goStopButton, false);
  
  var resetButton = document.getElementById("the-reset-button");
  resetButton.addEventListener("click", resetModel, false);
  
  var maxCarsInput = document.getElementById("max-cars-input");
  maxCarsInput.addEventListener("input", setMaxCars, false);
  
  var launchRateSlider = document.getElementById("launch-rate-slider");
  launchRateSlider.addEventListener("input", getLaunchRate, false);
  
  var launchRateOutput = document.getElementById("launch-rate-output");
  
  var congestionSlider = document.getElementById("congestion-slider");
  congestionSlider.addEventListener("input", getCongestionCoef, false);
  
  var congestionOutput = document.getElementById("congestion-output");
  
  var launchTimingMenu = document.getElementById("launch-timing-menu");
  launchTimingMenu.addEventListener("change", getLaunchTiming, false);
  
  var routingModeMenu = document.getElementById("routing-mode-menu");
  routingModeMenu.addEventListener("change", getRoutingMode, false);
  
  var speedMenu = document.getElementById("speed-menu");
  speedMenu.addEventListener("change", getSpeedMode, false);
  
  var selectionMethodMenu = document.getElementById("selection-method-menu");
  selectionMethodMenu.addEventListener("change", getSelectionMethod, false);
  
  var geekToggle = document.getElementById("geek-out");
  geekToggle.addEventListener("click", toggleGeekMode, false);
  
  var hintToggle = document.getElementById("hint-toggle");
  hintToggle.addEventListener("click", toggleHints, false);
  
  var hintStylesheet = document.getElementById("hint-stylesheet");
  
  
  
    // globals
  var modelState = "stopped"; // other states are "running" and "stopping"
  var bridgeBlocked = true;
  var routingMode = "selfish";   // other mode is "random" 
  var speedMode = "theoretical"  // alternatives are "actual," "historical"
  var selectionMethod = "minimum"  // other choice is "weighted-probability"
  var launchTiming = "poisson";   // others are "uniform," "periodic"
  var launchTimer = poisson;      // pointer to function
  var globalClock = 0;       // integer count of simulation steps, for measuring travel time
  var nextDeparture = 0;      // next clock reading at which a car is due to depart
  var maxCars = Infinity;      // specified by the macCarsInput element; if blank, no limit
  var animationTimer;        // for setInterval/clearInterval
  var carRadius = 3;         
  var carLength = 2 * carRadius;
  var totalPathLength = 1620;
  var carQueueSize = (totalPathLength / carLength) + 10;   // make sure we never run out of cars
  var carArray = new Array(carQueueSize);                  // retain pointers to all cars, so we can loop through them
  var speedLimit = 3;        // distance per time step in free-flowing traffic
  var launchRate = 0.55;  // rate at which cars attempt to enter the network at Origin; exact meaning depends on launchTiming
  var congestionCoef = 0.55;  // 0 means no congestion slowing at all; 1 means max density, traffic slows almost to a stop
  var quickestTrip = 582 / speedLimit;    // Minimum number of time steps to traverse shortest route with zero congestion
  var geekMode = false;     // whether to show extra geeky controls; initially no
  var hintMode = true;      // whether to show tooltips; intially yes

  
  
  
  
  // probability distributions and related stuff
  
  function coinFlip() {
    return Math.random() < 0.5;      // note: returns boolean
  }
  
    // Return a random interval drawn from exponential distribution
    // with rate parameter lambda
    // Why 1 - Math.random() rather than just plain Math.random()?
    // So that we get (0,1] instead of [0, 1), thereby avoiding the
    // risk of taking log(0).
    // The parameter lambda, which determines the intensity of the
    // Poisson process, will be given a value of launchRate/speedLimit,
    // which ranges from 0 to 1/3.
  function poisson(lambda) {
    return -Math.log(1 - Math.random()) / lambda;
  }
  
    // Return a real chosen uniformly at random from a finite interval [0, d),
    // where d = 2 / lambda. Thus the mean of the distribution is 1 / lambda.
  function uniform(lambda) {
    return Math.random() * 2 / lambda;
  }
  
    // Generates a simple periodic sequence, without randomness, with period
    // 1 / lambda. But note that cars are launched only at integer instants,
    // so the observed stream of cars may not be as regular as this function
    // would suggest.
  function periodic(lambda) {
    return 1 / lambda;
  }
  
  
  
    // The road network is built from two kinds of components: nodes, where
    // roads begin or end of intersect, and links, which are directed paths running
    // from one node to the next.
  
    // Most of the logic in the model is implemented by the nodes, which
    // act as routers for the cars. Visually, a node is an SVG circle. Algorithmically,
    // it's a buffer with a capacity of one car.
  
    // constructor for Nodes
  var Node = function(idStr) {
    this.nodeName = idStr;
    this.svgCircle = document.getElementById(idStr);  // visible representation
    this.x = this.svgCircle.cx.baseVal.value;         // get coords from the HTML
    this.y = this.svgCircle.cy.baseVal.value;         // "baseVal.value" because animatable
    this.car = null;
  }
    
  Node.prototype.hasRoom = function() {       // must call before trying to pass along a car
    return !this.car;
  }
  
  Node.prototype.accept = function(car) {     // no worries about atomicity; js is single-threaded
    this.car = car;
  }
  
    // clean up if somebody presses the reset button
  Node.prototype.evacuate = function() {
    if (this.car) {
      this.car.park();      // back to the parking lot
      this.car = null;
    }
  }

  
    // The dispatch function is the main duty of a node -- deciding where
    // each car goes next and moving it along. Actually, there's not much
    // deciding to be done. Each car carries its own itinerary, so the node
    // merely has to consult this record and place the car on the appropriate
    // link. The itinerary takes the form of a dictionary with the structure
    // {"orig": link, "south": link, "north": link, "dest": link}, where the
    // keys are the names of nodes, and the values are links.
  Node.prototype.dispatch = function() {
    if (this.car) {
      this.nextLink = this.car.route.directions[this.nodeName];   // find the link where this car wants to go
      if (this.nextLink.carQ.len === 0 || this.nextLink.carQ.last().progress >= carLength) {  // can the link accept a car?
        this.car.progress = 0;                      // recording position along the link
        this.car.avatar.setAttribute("cx", this.x); // avatar is the visual representation of the car in SVGland
        this.car.avatar.setAttribute("cy", this.y);
        this.nextLink.carQ.enqueue(this.car);       // send the car on its way
        this.nextLink.updateSpeed();                // recalculate speed based on occupancy of link
        this.car = null;                            // empty buffer, ready for next
      }
    }
  }
  
    // the four nodes of the Braess road network
  var orig = new Node("orig");
  var dest = new Node("dest");
  var south = new Node("south");
  var north = new Node("north");
  
  
    // The final destination node has some special duties, so we override
    // the dispatch method. 
  dest.dispatch = function() {
    if (this.car) {
      Dashboard.recordArrival(this.car);                  // Dashboard is where we record stats
      this.car.park();
      this.car = null;
    }
  }
  

  // Now we move on to the links, the roadways of the model. Again there's a
  // visible manifestation as an SVG element and a behind-the-scenes data
  // structure, which takes the form a queue. (See queue.js for details on
  // the latter.)
  // Note that much of the basic data about the link comes from the SVG
  // (which is defined in index.html): the length of the path, start and end
  // coordinates, which class of road it is (congestible or not).
  
    // constructor for links; oNode and dNode are the origin and destination nodes
  var Link = function(idStr, oNode, dNode) {
    this.id = idStr;
    this.svgPath = document.getElementById(idStr);
    this.pathLength = Math.round(this.svgPath.getTotalLength());  // rounding to ensure lengths A=B and a=b
    this.originXY = this.svgPath.getPointAtLength(0);
    this.destinationXY = this.svgPath.getPointAtLength(this.pathLength);
    this.originNode = oNode;
    this.destinationNode = dNode;
    this.openToTraffic = true;                  // always true except for bridge links
    this.carQ = new Queue(carQueueSize);        // vehicles currently driving on this link
    this.congestible = this.svgPath.classList.contains("thin-road");    // true for a and b only
    this.occupancy = this.carQ.len;
    this.speed = speedLimit;
    this.travelTime = this.pathLength / speedLimit;   // default value, will be overridden
  }
  
  Link.prototype.updateSpeed = function() {      // default, works for wide roads; will override for a and b
    this.speed = speedLimit;
    this.travelTime = this.pathLength / this.speed;
  }
    
  Link.prototype.getCarXY = function(progress) {     // 0 <= progress <= path.length
    return this.svgPath.getPointAtLength(progress);
  }
  
    // This is where the rubber meets the road, the procedure that actually
    // moves the cars along a link. It's also where most of the CPU cycles
    // get spent.
    //    The basic idea is to take a car's current speed, determine how far it
    // will move along the path at that speed in one time step, and update
    // its xy coordinates. But there's a complication: The car may not be able
    // to move that far if there's another car in front of it. 
    //    The first car in the queue needs special treatment. We know there's
    // no one in front of it, but it may be near the end of the path.
  
  Link.prototype.drive = function() {
    var i, car, firstCar, leader, follower, carXY;
    if (this.carQ.len > 0) {
      firstCar = this.carQ.peek(0);
      firstCar.pastProgress = firstCar.progress;
      firstCar.progress = Math.min(this.pathLength, firstCar.progress + this.speed);  // don't go off the end
      firstCar.odometer += firstCar.progress - firstCar.pastProgress;                 // cumulative distance over whole route
      carXY = this.getCarXY(firstCar.progress);
      firstCar.avatar.setAttribute("cx", carXY.x);      // setting SVG coords
      firstCar.avatar.setAttribute("cy", carXY.y);
      
      for (i = 1; i < this.carQ.len; i++) {      // now for all the cars after the first one
        leader = this.carQ.peek(i - 1);
        follower = this.carQ.peek(i);
        follower.pastProgress = follower.progress;
        follower.progress = Math.min(follower.progress + this.speed, leader.progress - carLength);  // don't rear-end the leader
        follower.odometer += follower.progress - follower.pastProgress;
        carXY = this.getCarXY(follower.progress);
        follower.avatar.setAttribute("cx", carXY.x);
        follower.avatar.setAttribute("cy", carXY.y);
      }
      
      if (firstCar.progress >= this.pathLength && this.destinationNode.hasRoom()) {    // hand off car to destination node
        this.destinationNode.accept(this.carQ.dequeue());
        this.updateSpeed();      // occupancy has decreased by 1
      }
    }
  }

  
    // when Reset pressed, dump all the cars back to the parking lot
  Link.prototype.evacuate = function() {
    while (this.carQ.len > 0) {
      var c = this.carQ.dequeue();
      c.park();
    }
    this.updateSpeed();
  }

    // here we create the six links of the road network
  var aLink = new Link("a", orig, south);
  var ALink = new Link("A", orig, north);
  var bLink = new Link("b", north, dest);
  var BLink = new Link("B", south, dest);
  var snLink = new Link("sn-bridge", south, north);
  var nsLink = new Link("ns-bridge", north, south);

    // default state, bridge closed in both directions
  snLink.openToTraffic = false;
  nsLink.openToTraffic = false;
    
    // We need to override the updateSpeed method for the narrow links a and b,
    // where traffic slows as a function of density. Under the formula given here,
    // if occupancy === 0 (i.e., no cars on the road), speed === speedLimit. At
    // maximum occupancy and congestionCoef === 1, speed falls to 0 and travelTime
    // diverges. The if stmt makes sure speed is always strictly positive.
  aLink.updateSpeed = function() {
    var epsilon = 1e-10;
    this.occupancy = this.carQ.len;
    this.speed = speedLimit - (this.occupancy * carLength * speedLimit * congestionCoef) / this.pathLength;
    if (this.speed <= 0) {
      this.speed = epsilon;
    }
    this.travelTime = this.pathLength / this.speed;
  }

    // borrow the aLink method for bLink
  bLink.updateSpeed = aLink.updateSpeed;

  
    // The following four method overrides are for efficiency only. They
    // can be eliminated without changing functionality.
    //    The default getCarXY uses the SVG path method getPointAtLength.
    // Profiling suggests that the program spends most of its cpu cycles 
    // executing this function. Four of the links are axis-parallel straight
    // lines, for which we can easily calculate position without going into
    // the SVG path.
  aLink.getCarXY = function(progress) {
    var y = this.originXY.y;
    var x = this.originXY.x + progress;
    return {"x": x, "y": y};             // return a point object in same format as getPointAtLength
  }
  
  bLink.getCarXY = aLink.getCarXY;      // again bLink borrows the method
  
  snLink.getCarXY = function(progress) {
    var x = this.originXY.x;
    var y = this.originXY.y + progress;
    return {"x": x, "y": y}; 
  }
  
  nsLink.getCarXY = function(progress) {   // borrowing won't work in this case because of sign difference
    var x = this.originXY.x;
    var y = this.originXY.y - progress;
    return {"x": x, "y": y};
  }
  
    // this one is not a link, just a bare queue, but
    // it has a closely analogous function. This is the holding
    // pen for cars after they reach the destination and before
    // they get recycled to the origin.
  var parkingLot = new Queue(carQueueSize);   // holds idle cars
  
  
  // A Route object encodes a sequence of links leading from Origin
  // to Destination. For the road network in this model, there are
  // just two possible routes when the bridge is closed, four when
  // it is open. Each of these routes has an associated color; the
  // cars following the route display the color. And the route
  // also includes a directions object that instructs each node
  // on how to handle a car following the route.
  
    // constructor
  var Route = function() {
    this.label = "";
    this.paintColor = null;
    this.directions = {"orig": null, "south": null, "north": null, "dest": null};
    this.itinerary = [];
    this.routeLength = 0;
    this.travelTime = 0;
  }
  
    // total length is just sum of constituent link lengths
  Route.prototype.calcRouteLength = function() {
    var rtl = 0;
    this.itinerary.forEach(function(link) {
      rtl += link.pathLength;
    })
    this.routeLength = rtl;
  }
  
    // For calculating the expected travel time over a route, we have a 
    // choice of three procedures. (The choice is determined by the
    // Speed Measurement selector.)
  
  Route.prototype.calcTravelTime = function() {
    if (speedMode === "theoretical") {
      this.calcTravelTimeTheoretical();
    }
    else if (speedMode === "actual") {
      this.calcTravelTimeActual();
    }
    else {
      this.calcTravelTimeHistorical();
    }
  }
  
  
    // The theoretical travel time comes straight out of the definition
    // of the model. For links a and b travel time is a function of
    // occupancy -- the number of cars traversing the link. All other
    // links have travel time proportional to their length, regardless
    // of traffic density. Thus we can just add up these numbers for
    // the links composing a route.
    //   Why is this value "theoretical"? It assumes that cars always
    // travel at the speed limit on all non-congestible links. But in
    // there may be delays getting onto and off of those links, causing
    // "queue spillback" and increasing the travel time. Calculations
    // based on theretical values may therefore underestimate the true
    // travel time.
  Route.prototype.calcTravelTimeTheoretical = function() {
    var tt = 0;
    this.itinerary.forEach(function(link) {tt += link.travelTime;})
    this.travelTime = tt;
  }
  
  
    // An alternative to the theoretical approach is to actually measure
    // the speed of cars currently traversing the route, and take an
    // average.
    //    TODO: I had a reason for looping through all cars, rather than
    // just those on the route (using queue.prototype.peek(i)) but I've
    // forgotten what it was. Now looks like a blunder.
  Route.prototype.calcTravelTimeActual = function() {
    var i, c, v, tt, n = 0, sum = 0;
    for (i = 0; i < carQueueSize; i++) {    // loop through all cars
      c = carArray[i];
      if (c.route === this && c.odometer > 0) {    // select only cars on our route that have begun moving
        v = (c.odometer / (globalClock - c.departTime)) * speedLimit;   // speed
        tt = this.routeLength / v;    // travel time
        sum += tt;    // sum of travel times for all cars on the route
        n++
      }
    }
    if (n === 0) {
      this.travelTime = this.routeLength / speedLimit;    // if no cars on this route, use default travel time
    }
    else {
      this.travelTime = sum / n;    // average travel time for all cars on the route
    }
  }
  
  
    // A third approach: Use the cumulative statistics on travel times experienced
    // by all cars that have completed the route. 
  Route.prototype.calcTravelTimeHistorical = function() {
    if (Dashboard.counts[this.label] === 0) {
      this.travelTime = this.routeLength / speedLimit;    // if no data, use the default value
    }
    else {
      this.travelTime = Dashboard.times[this.label] / Dashboard.counts[this.label];    // average travel time
    }
  }
  
  
    // Define the four possible routes as instances of Route().
  
  var Ab = new Route();
  Ab.label = "Ab";
  Ab.paintColor = "#cb0130";
  Ab.directions = {"orig": ALink, "south": null, "north": bLink, "dest": parkingLot};
  Ab.itinerary = [ALink, bLink];
  Ab.calcRouteLength();
  
  var aB = new Route();
  aB.label = "aB";
  aB.paintColor = "#1010a5";
  aB.directions = {"orig": aLink, "south": BLink, "north": null, "dest": parkingLot};
  aB.itinerary = [aLink, BLink];
  aB.calcRouteLength();
  
  var AB = new Route();
  AB.label = "AB";
  AB.paintColor = "#ffc526";
  AB.directions = {"orig": ALink, "south": BLink, "north": nsLink, "dest": parkingLot};
  AB.itinerary = [ALink, nsLink, BLink];
  AB.calcRouteLength();
  
  var ab = new Route();
  ab.label = "ab";
  ab.paintColor = "#4b9b55";
  ab.directions = {"orig": aLink, "south": snLink, "north": bLink, "dest": parkingLot};
  ab.itinerary = [aLink, snLink, bLink];
  ab.calcRouteLength();
    
  
  
    // When a car is about to be launched upon a trip through the road
    // network, we have to choose which route it will follow. In general, 
    // the choice is based on the expected travel time, as determined by
    // one of the three methods above. But there are many ways to put the
    // timing information to use.
    //    Each of the functions below takes one argument, a list of all
    // available routes. This will be a list of either two or four elements,
    // depending on whether the bridge is closed or open.
  
  var chooser = {};    // holder object for the three methods below
    
    // The random chooser just ignores the route timings and chooses
    // one of the available routes uniformly at random.
  chooser.random = function(routeList) {
    return routeList[Math.floor(Math.random() * routeList.length)];
  }
  
    // The min chooser always takes the route with the shortest expected
    // travel time, no matter how small the advantage might be. If multiple
    // routes have exactly the same time, the choice is random
  chooser.min = function(routeList) {
    var minVal = Infinity;
    var minRoutes = [];
    for (var i = 0; i < routeList.length; i++) {
      if (routeList[i].travelTime < minVal) {
        minVal = routeList[i].travelTime;
        minRoutes = [routeList[i]];        // best yet, make sole element of minRoutes
      }
      else if (routeList[i].travelTime === minVal) {
        minRoutes.push(routeList[i]);      // equal times, append to minRoutes list
      }
    }
    if (minRoutes.length === 1) {
      return minRoutes[0];        // the one fastest route
    }
    else {
      return minRoutes[Math.floor(Math.random() * minRoutes.length)];    // random choice among all best
    }
  }
    
    // Rather than the winner-take-all strategy of the min chooser, here we
    // make a random choice with probabilities weighted according to the 
    // travel times. Thus a small difference between two routes yields only
    // a slightly greater likelihood.
  chooser.probabilistic = function(routeList) {
    var valSum = 0;
    for (var i = 0; i < routeList.length; i++) {
      routeList[i].travelTime = 1 / routeList[i].travelTime;    // inverse of travel time
      valSum += routeList[i].travelTime;                        // sum of the reciprocals
    }
    routeList.forEach(function(rt) {rt.travelTime /= valSum});  // normalize so probabilities sum to 1
    var r = Math.random();
    var accum = 0;
    for (var i = 0; i < routeList.length; i++) {     // step through routes until cumulative
      accum += routeList[i].travelTime;              // weighted probability > random r
      if (accum > r) {
          return routeList[i];
      }
    }
  }

      
    // The ugly nest of if-else clauses, based on two state variables,
    // routingMode and selectionMethod.
  function chooseRoute() {
    var availableRoutes;
    if (bridgeBlocked) {
      availableRoutes = [Ab, aB];
    }
    else {
      availableRoutes = [Ab, aB, AB, ab];
    }
    if (routingMode === "random") {
      return chooser.random(availableRoutes);
    }
    else {                                          // routingMode === "selfish"
      availableRoutes.forEach(function(route) {
        route.calcTravelTime();
      });
      if (selectionMethod === "minimum") {
        return chooser.min(availableRoutes);
      }
      else {                                        // selectionMethod === "probabilistic"
        return chooser.probabilistic(availableRoutes);
      }
    }
  }
  
  // The cars are Javascript objects, with a "abatar" property that holds info
  // about the visual representation in SVG. We put the avatars into the DOM
  // at init time and then leave them there, to avoid the cost of repeated DOM
  // insertions and removals. Cars that aren't currently on the road are still
  // in the DOM but are hidden with display: none.
  
  // constructor for cars
  var Car = function() {
    this.serialNumber = null;  // invariant assigned at creation, mostly for debugging use
    this.progress = 0;         // records distance traveled along a link (reset after leaving link)
    this.pastProgress = 0;     // at t-1, so we can calculate distance traveled at step t
    this.departTime = 0;       // globalClock reading at orig node
    this.arriveTime = 0;       // globalClock reading at dest node
    this.route = null;         // route chosen for the car at time of launch
    this.odometer = 0;         // cumulative distance traveled throughout route (not just link)
    this.avatar = document.createElementNS(xmlns, "circle");    // the SVG element
    this.avatar.setAttribute("class", "car");
    this.avatar.setAttribute("cx", 0);
    this.avatar.setAttribute("cy", 0);
    this.avatar.setAttribute("r", carRadius);
    this.avatar.setAttribute("fill", "#000");      // will be changed at launch to route color
    this.avatar.setAttribute("display", "none");   // hidden until launched
    frame.appendChild(this.avatar);                // add avatar to the DOM
    parkingLot.enqueue(this);                      // add object to the holding pen
  }
  
    // Reset a car to default "parked" state, and add it to the
    // parking lot queue. Used when a car reaches the destination node
    // or when the model is reset via UI button.
  Car.prototype.park = function() {
    this.avatar.setAttribute("display", "none");
    this.avatar.setAttribute("fill", "#000");
    this.avatar.setAttribute("cx", 0);
    this.avatar.setAttribute("cy", 0);
    this.route = null;
    this.progress = 0;
    this.pastProgress = 0;
    this.odometer = 0;
    parkingLot.enqueue(this);
  }

    // Here's where we make all the cars. Note that new Car() enqueues them in
    // parkingLot.
  function makeCars(n) {
    for (var i=0; i<n; i++) {
      var c = new Car();
      c.serialNumber = i;
      carArray[i] = c;
    }
  }
  
    // runs on load
  function init() {
    makeCars(carQueueSize);
    globalClock = 0;
    syncControls();
    ALink.updateSpeed();
    aLink.updateSpeed();
    BLink.updateSpeed();
    bLink.updateSpeed();
    nsLink.updateSpeed();
    snLink.updateSpeed();
    Dashboard.colorize();
    setupForTouch();
  }
  
    // Make sure the on-screen input elements correctly reflect the values
    // of corresponding js variables. (This is needed mainly for Firefox,
    // which does not reset inputs on page reload.)
  function syncControls() {
    congestionSlider.value = congestionCoef;
    launchRateSlider.value = launchRate;
    routingModeMenu.value = routingMode;
    launchTimingMenu.value = launchTiming;
    speedMenu.value = speedMode;
    selectionMethodMenu.value = selectionMethod;
    maxCarsInput.value = "";
    var geekyControls = document.querySelectorAll(".geeky");
    for (var i=0; i<geekyControls.length; i++) {
      geekyControls[i].style.display = "none";
    }
    geekToggle.textContent = "More controls"
    geekMode = false;
  }
  
  
  
    // Dashboard for recording and displaying stats. The "counts" and "times"
    // dictionaries keep track of how many cars have traversed each route and
    // how long they took to do it. Each of these values is linked to a cell
    // in an HTML table.  
  
  var Dashboard = {
    departureCount: 0,
    arrivalCount: 0,
    counts: {
      "Ab": 0, "aB": 0, "AB": 0, "ab": 0, "total": 0
    },
    times: {
      "Ab": 0, "aB": 0, "AB": 0, "ab": 0, "total": 0
    },
    countReadouts:   {
    Ab: document.getElementById("Ab-count"),      // links to HTML table cells
    aB: document.getElementById("aB-count"),
    AB: document.getElementById("AB-count"),
    ab: document.getElementById("ab-count"),
    total: document.getElementById("total-count")
    },

    timeReadouts:   {
    Ab: document.getElementById("Ab-time"),
    aB: document.getElementById("aB-time"),
    AB: document.getElementById("AB-time"),
    ab: document.getElementById("ab-time"),
    total: document.getElementById("total-time")
    },
    
    colorize: function() {
      var AbRow = document.getElementById("Ab-row");    // make cell backgrounds match car colors
      AbRow.style.backgroundColor = Ab.paintColor;
      var aBRow = document.getElementById("aB-row");
      aBRow.style.backgroundColor = aB.paintColor;
      var ABRow = document.getElementById("AB-row");
      ABRow.style.backgroundColor = AB.paintColor;
      var abRow = document.getElementById("ab-row");
      abRow.style.backgroundColor = ab.paintColor;
      var totalRow = document.getElementById("total-row");
      totalRow.style.backgroundColor = "#000";
    },

    recordDeparture: function() {            // called by launchCar
      this.departureCount++
    },
    
    recordArrival: function(car) {          // called by dest.dispatch
      var elapsed = (globalClock - car.departTime) / speedLimit;
      var routeCode = car.route.label;
      this.counts[routeCode]++;
      this.counts["total"]++;
      this.times[routeCode] += elapsed;    // Note: we're storing total time for all cars; need to divide by n
      this.times["total"] += elapsed;
      this.updateReadouts();
    },
    
    
      // For the time readout, we divide total elapsed time by number of
      // cars to get time per car; we then also divide by the duration of the
      // quickest conceivable trip from Origin to Destination. Thus all times
      // are reported in units of this fastest trip. 
    updateReadouts: function() {
      for (var ct in this.countReadouts) {
        this.countReadouts[ct].textContent = this.counts[ct];
      }
      for (var tm in this.timeReadouts) {
        if (this.counts[tm] === 0) {
          this.timeReadouts[tm].textContent = "--";
        }
        else {
          this.timeReadouts[tm].textContent = ((this.times[tm] / this.counts[tm]) / quickestTrip).toFixed(3);
        }
      }
    },
    
    reset: function() {          // Reset button blanks out the stats display.
      this.departureCount = 0;
      this.arrivalCount = 0;
      for (var ct in this.counts) {
        this.counts[ct] = 0;
      }
      for (var tm in this.times) {
        this.times[tm] = 0;
      }
      this.updateReadouts();
    }
  }
  

  // Event handlers and other routines connected with controls and the user interface.
    
    // The Go button starts the animation, but the Stop button doesn't stop it.
    // Instead we just set a state variable, change the button text to "Wait",
    // and let any cars still on the road find their way to the destination.
    // The step function -- the procedure run on every time step -- will eventually
    // stop the periodic updates.
  function goStopButton(e) {
    if (modelState === "stopped") {
      modelState = "running";
      goButton.innerHTML = "Stop";
      animate();
    }
    else if (modelState === "running") {
      modelState = "stopping";
      goButton.innerHTML = "Wait";
      goButton.disabled = true;
    }
  }
  
    // Handler for the Reset button. If the model is running, we need to
    // stop the animation. Then we clear all cars from links and nodes,
    // clear the dashboard, and reset a few globals.
  function resetModel(e) {
    linksAndNodes = [ALink, aLink, BLink, bLink, nsLink, snLink, orig, dest, north, south];
    if (modelState === "running") {
      modelState = "stopped";
      goButton.innerHTML = "Go";
      window.clearInterval(animationTimer);
    }
    for (var i = 0; i < linksAndNodes.length; i++) {
      linksAndNodes[i].evacuate();
    }
    globalClock = 0;
    nextDeparture = 0;
    Dashboard.reset();
  }
  
  
    // Handler for the numeric input that allows us to run a specified number
    // of cars through the system.
  function setMaxCars(e) {
    var limit = parseInt(maxCarsInput.value, 10);
    if (limit === 0) {
      maxCars = Infinity;
    }
    else {
      maxCars = limit;
    }
  }

    // Handler for clicks on the bridge in the middle of the roadway network.
    // Initial state is blocked; clicks toggle between open and closed. Visual
    // indicators are handled by altering the classList.
  function toggleBridge() {
    bridgeBlocked = !bridgeBlocked;
    snLink.openToTraffic = !snLink.openToTraffic;
    nsLink.openToTraffic = !nsLink.openToTraffic;
    snBridge.classList.toggle("closed");
    nsBridge.classList.toggle("closed");
    theBarricade.classList.toggle("hidden");
  }
  
    // Handler for the Vehicle Launch Rate input (which will be rendered as a 
    // slider by most modern browsers).
  function getLaunchRate(e) {
    launchRate = Math.max(launchRateSlider.value, 0.001);
    launchRateOutput.textContent = launchRate.toFixed(2);
    nextDeparture = globalClock + launchTimer(launchRate / speedLimit);
  }
  
    // Handler for the Congestion Coefficient slider.
  function getCongestionCoef(e) {
    congestionCoef = parseFloat(congestionSlider.value);
    congestionOutput.textContent = congestionCoef.toFixed(2);
  }
  
    // Handler for Launch Timing select input.
  function getLaunchTiming(e) {
    var timings = {"poisson": poisson, "uniform": uniform, "periodic": periodic}
    var selectedTiming = launchTimingMenu.value;
    launchTiming = selectedTiming;
    launchTimer = timings[selectedTiming];
  }
  
    // Handler for Routing Mode select input.
  function getRoutingMode(e) {
    var selectedMode = routingModeMenu.value;
    routingMode = selectedMode;
  }
  
    // Handler for Speed Measurement select input.  
  function getSpeedMode(e) {
    var selectedMode = speedMenu.value;
    speedMode = selectedMode;
  }
  
    // Handler for Route Selection Method select input.  
  function getSelectionMethod(e) {
    var selectedMode = selectionMethodMenu.value;
    selectionMethod = selectedMode;
  }
  
    // With two sliders, four drop-down menus, a couple of buttons, and a numeric
    // input control, the UI looks a bit intimidating. To avoid scaring people away
    // on first acquaintance, we can hide all but the most basic controls, and
    // display the rest only on request. This is a handler for clicks on a "More
    // controls"/"Fewer controls" element at the bottom of the control panel.
  function toggleGeekMode(e) {
    var geekyControls = document.querySelectorAll(".geeky");
    if (geekMode) {
      for (var i=0; i<geekyControls.length; i++) {
        geekyControls[i].style.display = "none";
      }
      geekToggle.textContent = "More controls"
    }
    else {
      for (var i=0; i<geekyControls.length; i++) {
        geekyControls[i].style.display="block";
      }
      geekToggle.textContent = "Fewer controls"
   }
    geekMode = !geekMode;
  }
  
    // Tooltips, or "hover hints", explain what all the geeky controls are supposed
    // to control. But the hints themselves are annoying after you've seen them the
    // first few times, so we provide a ways to turn them off. This is the click
    // handler for the "Show/Hide hover hints" element at the bottom of the control panel.
    //    The hint implementation is a CSS-only solution by Kushagra Gour (see hint.css).
    // The easy way to turn it off and on is by disabling the whole stylesheet.
  function toggleHints(e) {
    if (hintMode) {
      hintStylesheet.disabled = true;
      hintToggle.textContent = "Show hover hints"
    }
    else {
      hintStylesheet.disabled = false;
      hintToggle.textContent = "Hide hover hints"
    }
    hintMode = !hintMode;
  }
  
    // Set up for Touch devices. Kill the hints and the geek mode. Uses class
    // added to the html tag by modernizr.
  function setupForTouch() {    
    if (Modernizr.touch) {
      if (geekMode) {
        toggleGeekMode();
      }
      if (hintMode) {
        toggleHints();
      }
      geekToggle.style.display = "none";
      hintToggle.style.display = "none";
    }
  }
  
  
  
  
    // Prints the contents of the Dashboard panel to the console at the end of the
    // run. Disabled by default; to activate, uncomment the line toward the end of
    // the step function, below.
  function saveStats() {
    var routes = ["Ab", "aB", "AB", "ab"];
    console.log("launchRate:", launchRate, "congestionCoef:", congestionCoef, "bridgeBlocked:", bridgeBlocked);
    for (var i=0; i<4; i++) {
      console.log(routes[i], Dashboard.countReadouts[routes[i]].textContent, Dashboard.timeReadouts[routes[i]].textContent);
    }
    console.log("total", Dashboard.countReadouts["total"].textContent, Dashboard.timeReadouts["total"].textContent);
  }
  
    // Just for producing graphs of occupancy levels; in default configuration,
    // the only call to this function is commented out. When activated, carCensus 
    // logs the number of cars on each route at each time step. The output is a sequence
    // of five numbers: time, Ab, aB, AB, ab.
  function carCensus(sampleInterval) {
    var routeCounts = {"Ab": 0, "aB": 0, "AB": 0, "ab": 0};
    var census = [globalClock, 0, 0, 0, 0]
    if (Dashboard.departureCount > 10000 && globalClock % sampleInterval === 0) {
      for (var i=0; i<carQueueSize; i++) {
        var c = carArray[i];
        if (c.route) {
          routeCounts[c.route.label] += 1;
        }
      }
      console.log(globalClock / speedLimit, routeCounts["Ab"], routeCounts["aB"], routeCounts["AB"], routeCounts["ab"])
    }
  }
    
    // Here we're at the starting line -- the procedure that prepares a car to
    // run the course and hands it off to the Origin node. But it's more complicated
    // than it should be. Not every call to launchCar actually launches a car.
    //    Abstractly, here's what happens. At intervals determined by our timer
    // function, a departure time is put on the schedule (by setting the global
    // variable nextDeparture). LaunchCar runs on each clock tick, and checks to
    // see if globalClock >= nextDeparture. However, the car can actually be launched
    // at that moment only if there is room for it in the orig node buffer. This
    // has nontrivial consequences when cars are being launched at high frequency.
    // 
  function launchCar() {
    if (orig.hasRoom() && globalClock >= nextDeparture && modelState === "running" && parkingLot.len > 0) {
      var nextCar = parkingLot.dequeue();
      nextCar.departTime = globalClock;
      nextCar.route = chooseRoute();
      nextCar.avatar.setAttribute("fill", nextCar.route.paintColor);
      nextCar.avatar.setAttribute("cx", orig.x);
      nextCar.avatar.setAttribute("cy", orig.y);
      nextCar.avatar.setAttribute("display", "block");
      orig.accept(nextCar);
      Dashboard.recordDeparture();
      nextDeparture = globalClock + launchTimer(launchRate / speedLimit);
    }
  }
  

  
  
    // The step function is the main driver of the simulation. The idea is
    // to poll all the nodes and links, moving cars along their route. But
    // in what sequence should we examine the nodes and links. It makes sense
    // to work backwards through the network, clearning space in later nodes
    // and links so that cars behind them can move up.
    //    There's another, subtler issue of sequencing. Every node except orig
    // has two links feeding into it. If we always attend to those links in the
    // same order, the later one might never get a chance to advance, if the
    // earlier one keeps the node always occupied. I thought I could avoid this
    // problem by simply alternating the sequence, but a deadlock is still
    // possible in heavy traffic. Randomizing the sequence seems to work well.
  function step() {
    if (coinFlip()) {
      dest.dispatch();
      bLink.drive();
      dest.dispatch();
      BLink.drive();
    }
    else {
      dest.dispatch();
      BLink.drive();
      dest.dispatch();
      bLink.drive();
    }
    if (coinFlip()) {
      north.dispatch();
      ALink.drive();
      north.dispatch();
      snLink.drive();
    }
    else {
      north.dispatch();
      snLink.drive();
      north.dispatch();
      ALink.drive();
    }
    if (coinFlip()) {
      south.dispatch();
      nsLink.drive();
      south.dispatch();
      aLink.drive();
    }
    else {
      south.dispatch();
      aLink.drive();
      south.dispatch();
      nsLink.drive();
    }
    orig.dispatch();
    launchCar();
    orig.dispatch();
    launchCar();
//    carCensus(9);      // uncomment to log route occupancy numbers on every time step
    globalClock += speedLimit;
    if (modelState === "stopping" && parkingLot.len === carQueueSize) {  // all cars back in the barn, shut down
      window.clearInterval(animationTimer);
      modelState = "stopped";
      goButton.innerHTML = "Go";
      goButton.removeAttribute("disabled");
//      saveStats();    // uncomment to output a summary of the run to the JS console
    }
    if (modelState === "running" && Dashboard.departureCount >= maxCars) {   // enough cars, stop launching
      modelState = "stopping";
      goButton.innerHTML = "Wait";
      goButton.setAttribute("disabled", true);
    }
  }
    
  
  function animate() {                                // called by Go button event handler
    animationTimer = window.setInterval(step, 15);    // 15 milliseconds = roughly 60 frames per second
  }
  
  
  init();
  

})();
