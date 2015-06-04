
/*
Implementation of queue as a circular buffer. Note: no checking
for overflow and underflow. Should never happen here.
*/

// constructor
  var Queue = function(maxItems) {
    this.n = maxItems;
    this.q = new Array(this.n);
    this.head = 0;
    this.len = 0;
  }
  
  Queue.prototype.length = function() {
    return this.len;
  }
  
  Queue.prototype.enqueue = function(item) {
    this.q[(this.head + this.len) % this.n] = item;
    this.len++;
  }
  
  Queue.prototype.dequeue = function() {
    var item = this.q[this.head];
    this.len--;
    this.head = (this.head + 1) % this.n;
    return item;
  }
  
  Queue.prototype.first = function() {
    return this.q[this.head];
  }
  
  Queue.prototype.last = function() {
    return this.q[(this.head + this.len - 1) % this.n];
  }
  
  Queue.prototype.peek = function(idx) {
    return this.q[(this.head + idx) % this.n];
  }
  
  
  
function qtest(n) {
  var q = new Queue(n);
  for (var i = 1; i <= n; i++) {
    q.enqueue(i);
  }
  for (var j = 1; j <= n; j++) {
    console.log(q.dequeue());
  }
}