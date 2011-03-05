/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: false, plusplus: true, bitwise: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global _, location, document*/
(function () {
  var change = function (direction) {
    return function () {
      var paramJson, params, queryString;
      paramJson = "{" + location.search.substring(1).replace(/\=/g, ":")
        .replace(/&/g, ",")
        .replace(/([0-9a-zA-Z\-]+):([0-9a-zA-Z\-]+)/g, "\"$1\":\"$2\"") + "}";
      params = JSON.parse(paramJson);
      params.offset = parseInt(params.offset, 10) + (direction * 20);
      if (params.offset < 0) {
        params.offset = 0;
      }
      queryString = _.keys(params).map(function (key) {
        return key + "=" + params[key];
      }).join("&");
      location.href = location.protocol + "//"  + location.host + 
        location.pathname + "?" + queryString;
    };
  };
  document.getElementById("next").addEventListener("click", change(1), false);
  document.getElementById("previous").addEventListener("click", change(-1), 
    false);
}());
