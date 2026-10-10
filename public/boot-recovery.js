(function () {
        var KEY = "pomich-boot-reload"
        var msg = document.getElementById("pomich-boot-msg")
        var btn = document.getElementById("pomich-boot-reload")
        var navigating = false

        function alreadyBusted() {
          try {
            return new URL(location.href).searchParams.has("_pomich")
          } catch (e) {
            return /[?&]_pomich=/.test(location.search || "")
          }
        }

        function hardNavigate() {
          if (navigating) return
          navigating = true
          var next
          try {
            var url = new URL(location.href)
            url.searchParams.set("_pomich", String(Date.now()))
            next = url.toString()
          } catch (e) {
            next = location.pathname + location.search + (location.search ? "&" : "?") + "_pomich=" + Date.now() + location.hash
          }
          try {
            location.replace(next)
          } catch (e1) {
            try {
              location.href = next
            } catch (e2) {}
          }
        }

        function clearCachesBestEffort() {
          try {
            if (window.caches && caches.keys) {
              caches.keys().then(function (keys) {
                keys.forEach(function (k) {
                  try {
                    caches.delete(k)
                  } catch (e) {}
                })
              })
            }
          } catch (e) {}
          try {
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
              navigator.serviceWorker.getRegistrations().then(function (regs) {
                regs.forEach(function (reg) {
                  try {
                    reg.unregister()
                  } catch (e) {}
                })
              })
            }
          } catch (e) {}
        }

        function clearAndReload() {
          if (btn) {
            btn.disabled = true
            btn.setAttribute("aria-busy", "true")
            btn.textContent = "Оновлюємо…"
          }
          if (msg) msg.textContent = "Очищаємо кеш і перезавантажуємо…"
          try {
            sessionStorage.setItem(KEY, "1")
          } catch (e) {}
          clearCachesBestEffort()
          window.setTimeout(hardNavigate, 120)
          window.setTimeout(hardNavigate, 1500)
        }

        function showReload(reason, auto) {
          if (msg) msg.textContent = reason || "Не вдалося завантажити. Натисніть «Оновити»."
          if (btn) {
            btn.style.display = "block"
            btn.disabled = false
            btn.textContent = "Оновити"
          }
          // Never auto-loop: if we already cache-busted once, wait for a tap.
          if (!auto || alreadyBusted()) return
          var already = false
          try {
            already = sessionStorage.getItem(KEY) === "1"
          } catch (e) {}
          if (!already) clearAndReload()
        }

        function isAppAssetFailure(target) {
          if (!target) return false
          var src = String(target.src || target.href || "")
          if (!src) return false
          // Only recover from our hashed Vite modules/CSS — not fonts, icons, or telegram.org.
          try {
            var u = new URL(src, location.href)
            if (u.origin !== location.origin) return false
            return /^\/assets\/.+\.(js|css)$/.test(u.pathname)
          } catch (e) {
            return /\/assets\/.+\.(js|css)(\?|$)/.test(src)
          }
        }

        if (btn) {
          btn.addEventListener("click", function (ev) {
            try {
              ev.preventDefault()
            } catch (e) {}
            clearAndReload()
          })
          btn.addEventListener(
            "touchend",
            function (ev) {
              try {
                ev.preventDefault()
              } catch (e) {}
              clearAndReload()
            },
            { passive: false },
          )
        }

        window.addEventListener(
          "error",
          function (ev) {
            var t = ev && ev.target
            if (!t || (t.tagName !== "SCRIPT" && t.tagName !== "LINK")) return
            if (!isAppAssetFailure(t)) return
            showReload("Після оновлення залишився старий кеш.", true)
          },
          true,
        )
        window.addEventListener("unhandledrejection", function (ev) {
          var reason = ev && ev.reason
          var text = (reason && (reason.message || String(reason))) || ""
          if (/Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(text)) {
            showReload("Після оновлення залишився старий кеш.", true)
          }
        })
        window.setTimeout(function () {
          var root = document.getElementById("root")
          if (!root) return
          if (!document.getElementById("pomich-boot")) return
          if (root.childElementCount > 1) return
          // Slow boot — offer a button, but do not auto-reload forever.
          showReload("Довге завантаження. Натисніть «Оновити».", false)
        }, 12000)
      })()
