(function () {
        var params = new URLSearchParams(window.location.search);
        var status = params.get('status') || 'ok';
        var reason = params.get('reason') || '';

        var statusLine = document.getElementById('status-line');
        var message = document.getElementById('message');
        var reasonEl = document.getElementById('reason');
        var backLink = document.getElementById('back-link');
        var dot = statusLine.querySelector('.dot');

        // Not every failure is X's fault — a dead local DB used to render as
        // "Twitter rejected the authorization", which sent debugging the wrong way.
        var HEADLINES = {
          persist_failed_db_down: 'Local Database Unreachable',
          persist_failed: 'Token Not Saved',
        };
        var MESSAGES = {
          persist_failed_db_down:
            'X authorized fine, but the local database is unreachable — is Docker running? ' +
            'Start it, then try again:  docker compose up -d',
          persist_failed:
            'X authorized fine, but saving the token failed. Check the dev server logs.',
        };

        if (status === 'error') {
          var headline = HEADLINES[reason] || 'Connection Failed';
          statusLine.setAttribute('data-status', 'error');
          statusLine.innerHTML =
            '<span class="dot" data-status="error"></span>' + headline;
          message.textContent =
            MESSAGES[reason] ||
            'Twitter rejected the authorization. Try again from the agent drawer.';
          backLink.setAttribute('data-status', 'error');
          if (reason) {
            reasonEl.textContent = 'reason: ' + reason;
          }
        }

        var seconds = 5;
        var countdown = document.getElementById('countdown');
        var tick = setInterval(function () {
          seconds--;
          if (seconds <= 0) {
            clearInterval(tick);
            countdown.textContent = 'Returning to the Threat Deck…';
            // close() only works if this window was opened by script. It is a
            // silent no-op for a normal tab, so always fall back to navigating
            // home — otherwise the user is stranded with no way back.
            window.close();
            setTimeout(function () {
              window.location.replace('/');
            }, 250);
            return;
          }
          countdown.textContent = 'Returning in ' + seconds + '…';
        }, 1000);
      })();
