/*   
  Road traffic simulator for exploring Braess's paradox.
  By Brian Hayes, 2015.
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
      this.car.avatar.setAttribute("display", "none");
      this.car.avatar.setAttribute("cx", 0);
      this.car.avatar.setAttribute("cy", 0);
      this.car.route = null;
      this.car.progress = 0;
      this.car.odometer = 0;
      parkingLot.enqueue(this.car);
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
      this.car.avatar.setAttribute("display", "none");    // hide it and restore defaults
      this.car.avatar.setAttribute("cx", 0);
      this.car.avatar.setAttribute("cy", 0);
      this.car.avatar.setAttribute("fill", "#000");
      this.car.route = null;
      this.car.progress = 0;
      this.car.odometer = 0;
      parkingLot.enqueue(this.car);            // An extra queue for cars in waiting
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
    // The basic idea is to take a car's current speed, determine how far it
    // will move along the path at that speed in one time step, and update
    // its xy coordinates. But there's a complication: The car may not be able
    // to move that far if there's another car in front of it, or if it's near
    // the end of the path. 
  Link.prototype.drive = function() {
    var i, car, firstCar, leader, follower, carXY;
    if (this.carQ.len > 0) {
      firstCar = this.carQ.peek(0);
      firstCar.pastProgress = firstCar.progress;
      firstCar.progress = Math.min(this.pathLength, firstCar.progress + this.speed);
      firstCar.odometer += firstCar.progress - firstCar.pastProgress;
      carXY = this.getCarXY(firstCar.progress);
      firstCar.avatar.setAttribute("cx", carXY.x);
      firstCar.avatar.setAttribute("cy", carXY.y);
      for (i = 1; i < this.carQ.len; i++) {
        leader = this.carQ.peek(i - 1);
        follower = this.carQ.peek(i);
        follower.pastProgress = follower.progress;
        follower.progress = Math.min(follower.progress + this.speed, leader.progress - carLength);
        follower.odometer += follower.progress - follower.pastProgress;
        carXY = this.getCarXY(follower.progress);
        follower.avatar.setAttribute("cx", carXY.x);
        follower.avatar.setAttribute("cy", carXY.y);
      }
      if (firstCar.progress >= this.pathLength && this.destinationNode.hasRoom()) {
        this.destinationNode.accept(this.carQ.dequeue());
        this.updateSpeed();
      }
    }
  }

  
  Link.prototype.evacuate = function() {
    while (this.carQ.len > 0) {
      var c = this.carQ.dequeue();
      c.avatar.setAttribute("display", "none");
      c.avatar.setAttribute("fill", "#000");
      c.avatar.setAttribute("cx", 0);
      c.avatar.setAttribute("cy", 0);
      c.route = [];
      c.progress = 0;
      c.odometer = 0;
      parkingLot.enqueue(c);
    }
    this.updateSpeed();
  }
  

  var aLink = new Link("a", orig, south);
  var ALink = new Link("A", orig, north);
  var bLink = new Link("b", north, dest);
  var BLink = new Link("B", south, dest);
  var snLink = new Link("sn-bridge", south, north);
  var nsLink = new Link("ns-bridge", north, south);
  snLink.openToTraffic = false;
  nsLink.openToTraffic = false;
    
  aLink.updateSpeed = function() {
    this.occupancy = this.carQ.len;
    this.speed = speedLimit - (this.occupancy * carLength * speedLimit * congestionCoef) / this.pathLength;
    this.travelTime = this.pathLength / this.speed;
  }
  
  bLink.updateSpeed = aLink.updateSpeed;

  aLink.getCarXY = function(progress) {
    var y = this.originXY.y;
    var x = this.originXY.x + progress;
    return {"x": x, "y": y}; 
  }
  
  bLink.getCarXY = aLink.getCarXY;
  
  snLink.getCarXY = function(progress) {
    var x = this.originXY.x;
    var y = this.originXY.y + progress;
    return {"x": x, "y": y}; 
  }
  
  nsLink.getCarXY = function(progress) {
    var x = this.originXY.x;
    var y = this.originXY.y - progress;
    return {"x": x, "y": y};
  }
  


  var parkingLot = new Queue(carQueueSize);   // holds idle cars
  
    // constructor
  var Route = function() {
    this.label = "";
    this.paintColor = null;
    this.directions = {"orig": null, "south": null, "north": null, "dest": null};
    this.itinerary = [];
    this.routeLength = 0;
    this.travelTime = 0;
    this.currentTravelTime = 0;
    this.chooserVal = 0;
  }
  
  Route.prototype.calcRouteLength = function() {
    var rtl = 0;
    this.itinerary.forEach(function(link) {
      rtl += link.pathLength;
    })
    this.routeLength = rtl;
  }
  
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
  
  Route.prototype.calcTravelTimeTheoretical = function() {
    var tt = 0;
    this.itinerary.forEach(function(link) {tt += link.travelTime;})
    this.travelTime = tt;
  }
  
  Route.prototype.calcTravelTimeActual = function() {
    var i, c, v, tt, n = 0, sum = 0;
    for (i = 0; i < carQueueSize; i++) {
      c = carArray[i];
      if (c.route === this && c.odometer > 0) {
        v = (c.odometer / (globalClock - c.departTime)) * speedLimit;
        tt = this.routeLength / v;
        sum += tt;
        n++
//        console.log(c.route.label, c.serialNumber, "odo:", c.odometer, "et:", (globalClock - c.departTime), "v:", v, "tt:", tt, "sum:", sum, "n:", n);
      }
    }
    if (n === 0) {
      this.travelTime = this.routeLength / speedLimit;
    }
    else {
      this.travelTime = sum / n;
    }
//    console.log(this.label, "sum", sum, "n", n, "travtm", this.travelTime);
  }
  
  Route.prototype.calcTravelTimeHistorical = function() {
    if (Dashboard.counts[this.label] === 0) {
      this.travelTime = this.routeLength / speedLimit;
    }
    else {
      this.travelTime = Dashboard.times[this.label] / Dashboard.counts[this.label];
    }
  }
  
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
    
  
  
    
  
  
  var chooser = {};
    
  chooser.random = function(routeList) {
    return routeList[Math.floor(Math.random() * routeList.length)];
  }
  
  chooser.min = function(routeList) {
    var minVal = Infinity;
    var minRoutes = [];
    for (var i = 0; i < routeList.length; i++) {
      if (routeList[i].travelTime < minVal) {
        minVal = routeList[i].travelTime;
        minRoutes = [routeList[i]];
      }
      else if (routeList[i].travelTime === minVal) {
        minRoutes.push(routeList[i]);
      }
    }
    if (minRoutes.length === 1) {
      return minRoutes[0];
    }
    else {
      return minRoutes[Math.floor(Math.random() * minRoutes.length)];
    }
  }
    
  chooser.probabilistic = function(routeList) {
    var valSum = 0;
    for (var i = 0; i < routeList.length; i++) {
      routeList[i].travelTime = 1 / routeList[i].travelTime;
      valSum += routeList[i].travelTime;
    }
    routeList.forEach(function(rt) {rt.travelTime /= valSum});
    var r = Math.random();
    var accum = 0;
    for (var i = 0; i < routeList.length; i++) {
      accum += routeList[i].travelTime;
      if (r <= accum) {
          return routeList[i];
      }
    }
  }

      
  
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
  
  


  
  
  
  
  // constructor for cars
  var Car = function() {
    this.serialNumber = null;
    this.progress = 0;
    this.pastProgress = 0;
    this.departTime = 0;
    this.arriveTime = 0;
    this.route = null;
    this.odometer = 0;
    this.avatar = document.createElementNS(xmlns, "circle");
    this.avatar.setAttribute("class", "car");
    this.avatar.setAttribute("cx", 0);
    this.avatar.setAttribute("cy", 0);
    this.avatar.setAttribute("r", carRadius);
    this.avatar.setAttribute("fill", "#000");
    this.avatar.setAttribute("display", "none");
    frame.appendChild(this.avatar);
    parkingLot.enqueue(this);
  }
    
  function makeCars(n) {
    for (var i=0; i<n; i++) {
      var c = new Car();
      c.serialNumber = i;
      carArray[i] = c;
    }
  }
  
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
  }
  
    
  function syncControls() {
    congestionSlider.value = congestionCoef;
    launchRateSlider.value = launchRate;
    routingModeMenu.value = routingMode;
    launchTimingMenu.value = launchTiming;
    maxCarsInput.value = "";
  }
  
  
  
    // dashboard for calculating and displaying stats
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
    Ab: document.getElementById("Ab-count"),
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
      var AbRow = document.getElementById("Ab-row");
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

    recordDeparture: function() {
      this.departureCount++
    },
    
    recordArrival: function(car) {
      var elapsed = (globalClock - car.departTime) / speedLimit;
      var routeCode = car.route.label;
      this.counts[routeCode]++;
      this.counts["total"]++;
      this.times[routeCode] += elapsed;
      this.times["total"] += elapsed;
      this.updateReadouts();
    },
    
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
    
    reset: function() {
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
//      modelState = "stopped";
//      goButton.innerHTML = "Go";
//      window.clearInterval(animationTimer);
    }
  }
  
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
  
  function setMaxCars(e) {
    var limit = parseInt(maxCarsInput.value, 10);
    if (limit === 0) {
      maxCars = Infinity;
    }
    else {
      maxCars = limit;
    }
  }

  
  function toggleBridge() {
    bridgeBlocked = !bridgeBlocked;
    snLink.openToTraffic = !snLink.openToTraffic;
    nsLink.openToTraffic = !nsLink.openToTraffic;
    snBridge.classList.toggle("closed");
    nsBridge.classList.toggle("closed");
    theBarricade.classList.toggle("hidden");
  }
  
  function getLaunchRate(e) {
    launchRate = Math.max(launchRateSlider.value, 0.001);
    launchRateOutput.textContent = launchRate.toFixed(2);
    nextDeparture = globalClock + launchTimer(launchRate / speedLimit);
  }
  
  function getCongestionCoef(e) {
    congestionCoef = parseFloat(congestionSlider.value);
    congestionOutput.textContent = congestionCoef.toFixed(2);
  }
  
  function getLaunchTiming(e) {
    var timings = {"poisson": poisson, "uniform": uniform, "periodic": periodic}
    var selectedTiming = launchTimingMenu.value;
    launchTiming = selectedTiming;
    launchTimer = timings[selectedTiming];
  }
  
  function getRoutingMode(e) {
//    var modes = {"selfish": selfishRouter, "random": randomRouter, "probabilistic": probabilisticRouter, "historical": historicalRouter};
    var selectedMode = routingModeMenu.value;
    routingMode = selectedMode;
//    routingFunction = modes[selectedMode];
  }
  
  function getSpeedMode(e) {
//    var modes = {"theoretical": selfishRouter, "actual": randomRouter, "historical": historicalRouter};
    var selectedMode = speedMenu.value;
    speedMode = selectedMode;
//    routingFunction = modes[selectedMode];
  }
  
  function getSelectionMethod(e) {
//    var modes = {"selfish": selfishRouter, "random": randomRouter, "probabilistic": probabilisticRouter, "historical": historicalRouter};
    var selectedMode = selectionMethodMenu.value;
    selectionMethod = selectedMode;
//    routingFunction = modes[selectedMode];
  }
  
  function toggleGeekMode(e) {
    var geekyControls = document.querySelectorAll(".geeky");
    console.log(geekyControls);
    if (geekMode) {
      for (var i=0; i<geekyControls.length; i++) {
        geekyControls[i].style.display = "none";
        geekToggle.textContent = "More controls"
      }
    }
    else {
      for (var i=0; i<geekyControls.length; i++) {
        geekyControls[i].style.display="block";
        geekToggle.textContent = "Fewer controls"
      }
    }
    geekMode = !geekMode;
  }
  
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
  
  
  function saveStats() {
    var routes = ["Ab", "aB", "AB", "ab"];
    console.log("launchRate:", launchRate, "congestionCoef:", congestionCoef, "bridgeBlocked:", bridgeBlocked);
    for (var i=0; i<4; i++) {
      console.log(routes[i], Dashboard.countReadouts[routes[i]].textContent, Dashboard.timeReadouts[routes[i]].textContent);
    }
    console.log("total", Dashboard.countReadouts["total"].textContent, Dashboard.timeReadouts["total"].textContent);
  }
    

  function launchCar() {
    if (orig.hasRoom() && globalClock >= nextDeparture && modelState === "running" && parkingLot.len > 0) {
      var nextCar = parkingLot.dequeue();
      nextCar.departTime = globalClock;
      nextCar.route = chooseRoute();
      nextCar.avatar.setAttribute("fill", nextCar.route.paintColor);
      nextCar.avatar.setAttribute("cx", orig.x);
      nextCar.avatar.setAttribute("cy", orig.y);
      orig.accept(nextCar);
      nextCar.avatar.setAttribute("display", "block");
      Dashboard.recordDeparture();
      nextDeparture = globalClock + launchTimer(launchRate / speedLimit);
    }
  }
  
  
  
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
    orig.dispatch();
    launchCar();
    globalClock += speedLimit;
//    var car54 = carArray[54];
//    if (car54.route) {
//      console.log(car54.route.label, car54.route.routeLength, car54.odometer, globalClock, car54.route.routeLength / (car54.odometer / (globalClock - car54.departTime)));
//    }
    if (modelState === "stopping" && parkingLot.len === carQueueSize) {
      window.clearInterval(animationTimer);
      modelState = "stopped";
      goButton.innerHTML = "Go";
      goButton.removeAttribute("disabled");
      saveStats();
    }
    if (modelState === "running" && Dashboard.departureCount >= maxCars) {
      modelState = "stopping";
      goButton.innerHTML = "Wait";
      goButton.setAttribute("disabled", true);
    }
  }
    
  
  function animate() {
    animationTimer = window.setInterval(step, 15);
  }
  
  
  init();
  

})();

