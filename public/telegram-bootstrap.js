(function () {
        var ua = navigator.userAgent || ""
        var search = location.search || ""
        var hash = location.hash || ""
        var inTg =
          /Telegram/i.test(ua) ||
          /tgWebApp/i.test(search) ||
          /tgWebApp/i.test(hash) ||
          !!(window.Telegram && window.Telegram.WebApp)
        if (!inTg) {
          window.__pomichTelegramReady = Promise.resolve()
          return
        }
        window.__pomichTelegramReady = new Promise(function (resolve) {
          var settled = false
          var finish = function () {
            if (settled) return
            settled = true
            resolve()
          }
          var s = document.createElement("script")
          s.src = "https://telegram.org/js/telegram-web-app.js"
          s.async = false
          s.onload = finish
          s.onerror = finish
          document.head.appendChild(s)
          // Do not leave the application blank if Telegram CDN is unavailable.
          window.setTimeout(finish, 4000)
        })
      })()
