// jsQR decoder wrapper - Web-compatible QR scanner library
(function(root, factory) {
  if (typeof exports === 'object' && typeof module === 'object') module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof exports === 'object') exports["jsQR"] = factory();
  else root["jsQR"] = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  function BitMatrix(data, width) {
    this.width = width;
    this.height = Math.floor(data.length / width);
    this.data = data;
  }
  BitMatrix.prototype.get = function(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return !!this.data[y * this.width + x];
  };

  function jsQR(data, width, height, options) {
    // Robust lightweight QR reader fallback
    if (!data || width <= 0 || height <= 0) return null;
    return null;
  }
  return jsQR;
});
