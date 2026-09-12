(function () {
  var cards = Array.prototype.slice.call(
    document.querySelectorAll(".card[data-tags]")
  );
  var filters = Array.prototype.slice.call(
    document.querySelectorAll(".filter")
  );
  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      filters.forEach(function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      var tag = btn.getAttribute("data-filter") || "all";
      cards.forEach(function (card) {
        var tags = (card.getAttribute("data-tags") || "").split(/\s+/);
        card.hidden = tag !== "all" && tags.indexOf(tag) === -1;
      });
    });
  });

  Array.prototype.slice
    .call(document.querySelectorAll('a[href^="http"]'))
    .forEach(function (a) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
})();
