
/*
Implementation of queue as a circular buffer. Note: no checking
for overflow and underflow. Should never happen here.

I chose the circular buffer rather than Javascript's built-in
'unshift' and 'pop' methods for efficiency reasons: This way I
get constant-time enqueue and dequeue, whereas 'unshift' is linear
in the length of the queue.
*/

// constructor
  var Queue = function(maxItems) {
    this.n = maxItems;
    this.q = new Array(this.n);
    this.head = 0;
    this.len = 0;
  };
  
  Queue.prototype.length = function() {
    return this.len;
  };
  
  Queue.prototype.enqueue = function(item) {
    this.q[(this.head + this.len) % this.n] = item;
    this.len++;
  };
  
  Queue.prototype.dequeue = function() {
    var item = this.q[this.head];
    this.len--;
    this.head = (this.head + 1) % this.n;
    return item;
  };
  
  Queue.prototype.first = function() {
    return this.q[this.head];
  };
  
  Queue.prototype.last = function() {
    return this.q[(this.head + this.len - 1) % this.n];
  };
  
  Queue.prototype.peek = function(idx) {
    return this.q[(this.head + idx) % this.n];
  };
  
  
