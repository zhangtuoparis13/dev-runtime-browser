/*Creating rethink iFrame*/

  try{ 

    let rethinkIframe = document.getElementById('rethink-iframe');

      if (!rethinkIframe) {
        rethinkIframe = document.createElement('iframe');
        rethinkIframe.setAttribute('id', 'rethink-iframe');
        rethinkIframe.setAttribute('seamless', '');
        rethinkIframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

        //rethinkIframe.style.display = 'none';
        document.querySelector('body').appendChild(rethinkIframe);

        // Instantiate the application inside the AppSandbox
        var script = document.createElement('script');
        script.type = 'text/JavaScript';
        script.src = 'rethink-iframe.js';

        sandbox.contentWindow.document.getElementsByTagName('body')[0].appendChild(script);
      }

    } catch (e) {
      throw new Error('Your environment does not allow the iframe deployment:  \n', e);
    }

