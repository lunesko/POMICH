(function () {
  var btn = document.getElementById("to-top")
  if (!btn) return
  var toggle = function () {
    if (window.scrollY > 320) btn.classList.add("is-visible")
    else btn.classList.remove("is-visible")
  }
  window.addEventListener("scroll", toggle, { passive: true })
  toggle()
  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" })
  })
})()
