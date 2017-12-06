/* global gameInstance, mat4, performance, Promise, VRFrameData, webvrui */
(function () {
  'use strict';

  var canvas = null;
  var containerEl = document.querySelector('#game');
  var controllerClassName = 'controller-icon';
  var controllerEl = document.querySelector('#webxr__motion-controller');
  var defaultHeight = 1.5;
  var enterEl = document.querySelector('#entervr');
  var frameData = null;
  var gamepads = [];
  var iconsEl = document.getElementById('#webxr__icons');
  var inFullscreen = false;
  var inVR = false;
  var isPresenting = false;
  var leftProjectionMatrix = mat4.create();
  var leftViewMatrix = mat4.create();
  var loaderEl = document.querySelector('#loader');
  var rightProjectionMatrix = mat4.create();
  var rightViewMatrix = mat4.create();
  var sitStand = mat4.create();
  var statusEl = document.getElementById('webxr__status');
  var testTimeStart = null;
  var vrDisplay = null;
  var vrGamepads = [];
  var webxrButtonEl = document.getElementById('webxr__button');
  var webxrButtonUI = null;
  var webxrExitEl = document.getElementById('webxr__exit');
  var webxrHelpEl = document.getElementById('webxr__help');
  var webxrLearnEl = document.getElementById('webxr__learn');
  var webxrUIEl = document.getElementById('webxr__ui');
  var windowRaf = window.requestAnimationFrame;

  function onReady () {
    if (!navigator.getVRDisplays) {
      console.warn('Your browser does not support WebVR!');
      return;
    }
    return (navigator.xr ? navigator.xr.requestDevice : navigator.getVRDisplays)().then(function (displays) {
      if (!Array.isArray(displays)) {
        vrDisplay = displays;
      }
      if (displays.length) {
        vrDisplay = displays[displays.length - 1];
      }
      if (!vrDisplay) {
        return;
      }

      webxrButtonUI = new webvrui.EnterVRButton(canvas, {
        color: '#111',
        corners: 'round',
        background: '#fff'
      }).on('enter', function () {
        console.log('[webvrui] enter VR');
      }).on('exit', function () {
        console.log('[webvrui] exit VR');
      }).on('error', function (err) {
        webxrLearnEl.removeClass('hidden');
        console.error('[webvrui] error:', err);
      })
      .on('hide', function () {
        webxrUIEl.classList.add('hidden');

        // On iOS there is no button to exit fullscreen mode, so we need to provide one.
        if (enterVR.state === webvrui.State.PRESENTING_FULLSCREEN) {
          webxrExitEl.removeClass('hidden');
        }
      })
      .on('show', function () {
        webxrUIEl.classList.remove('hidden');
        webxrExitEl.classList.add('hidden');
      });
      webxrButtonEl.appendChild(webxrButtonUI.domElement);

      // Check to see if we are polyfilled.
      if (vrDisplay.isPolyfilled) {
        // showInstruction(document.querySelector('#novr'));
      } else {
        statusEl.dataset.enabled = true;
      }

      onResize();

      if (!('VRFrameData' in window)) {
        throw new Error('Could not find `VRFrameData`');
      }

      onAnimate();

      if (vrDisplay.capabilities && vrDisplay.capabilities.canPresent) {
        enterEl.dataset.enabled = 'true';
      }
    });
  }

  function onUnity (msg) {
    if (msg.detail === 'Ready') {
      // Get and hide Unity's canvas instance.
      canvas = document.getElementById('#canvas');
      loaderEl.dataset.complete = 'true';
      onReady();
    }

    // Measures round-trip time from Unity.
    if (msg.detail === 'Timer') {
      var delta = performance.now() - testTimeStart;
      console.log('RTT (ms):', delta);
      testTimeStart = null;
    }

    if (msg.detail === 'PostRender' && isPresenting) {
      // WebVR: Indicate that we are ready to present the rendered frame to the VR display.
      vrDisplay.submitFrame();
    }
  }

  function enterFullscreen (force) {
    return new Promise(function (resolve, reject) {
      if (!force && inFullscreen) {
        return resolve(new Error('Already in fullscreen'));
      }
      if (!webxrButtonUI) {
        throw new Error('Could not find `webxrButtonUI` helper for entering fullscreen');
      }
      return webxrButtonUI.requestEnterFullscreen().then(function () {
        inFullscreen = true;
        resolve(true);
      }, function (err) {
        reject(err);
      }).catch(function (err) {
        reject(err);
      });
    });
  }

  function exitFullscreen (force) {
    return new Promise(function (resolve, reject) {
      if (!force && !inFullscreen) {
        return resolve(new Error('Not in fullscreen'));
      }
      if (!webxrButtonUI) {
        throw new Error('Could not find `webxrButtonUI` helper for entering fullscreen');
      }
      return webxrButtonUI.requestExit().then(function () {
        inFullscreen = false;
        resolve(true);
      }, function (err) {
        reject(err);
      }).catch(function (err) {
        reject(err);
      });
    });
  }

  function enterVR (force) {
    if (!force && inVR) {
      exitVR();
      return;
    }

    inVR = true;
    if (vrDisplay.capabilities && vrDisplay.capabilities.canPresent) {
      return (webxrButtonUI ?
        webxrButtonUI.requestPresent(vrDisplay, canvas) :
        vrDisplay.requestPresent([{source: canvas}])
      ).then(function () {
        var leftEye = vrDisplay.getEyeParameters('left');
        var rightEye = vrDisplay.getEyeParameters('right');
        var renderWidth = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
        var renderHeight = Math.max(leftEye.renderHeight, rightEye.renderHeight);
        canvas.width = renderWidth;
        canvas.height = renderHeight;
        onResize();
        isPresenting = true;

        return vrDisplay;
      });
    } else {
      throw new Error('Cannot present to VR device');
    }

    // Start stereo rendering in Unity.
    gameInstance.SendMessage('WebVRCameraSet', 'Begin');
  }

  function exitVR (force) {
    if (!force && !inVR) {
      return enterVR();
    }

    inVR = false;

    if (vrDisplay.isPresenting) {
      return (webxrButtonUI ? webxrButtonUI.requestExit : vrDisplay.exitPresent)().then(function () {
        isPresenting = false;

        // Start stereo rendering in Unity.
        gameInstance.SendMessage('WebVRCameraSet', 'End');

        onResize();
      });
    }

    onResize();

    return Promise.resolve(false);
  }

  function onAnimate () {
    window.requestAnimationFrame(onAnimate);

    // Headset framedata.
    frameData = new VRFrameData();
    vrDisplay.getFrameData(frameData);

    if (frameData) {
      // Convert view and projection matrices for use in Unity.
      mat4.copy(leftProjectionMatrix, frameData.leftProjectionMatrix);
      mat4.transpose(leftProjectionMatrix, leftProjectionMatrix);

      mat4.copy(rightProjectionMatrix, frameData.rightProjectionMatrix);
      mat4.transpose(rightProjectionMatrix, rightProjectionMatrix);

      mat4.copy(leftViewMatrix, frameData.leftViewMatrix);
      mat4.transpose(leftViewMatrix, leftViewMatrix);
      leftViewMatrix[2] *= -1;
      leftViewMatrix[6] *= -1;
      leftViewMatrix[10] *= -1;
      leftViewMatrix[14] *= -1;

      mat4.copy(rightViewMatrix, frameData.rightViewMatrix);
      mat4.transpose(rightViewMatrix, rightViewMatrix);
      rightViewMatrix[2] *= -1;
      rightViewMatrix[6] *= -1;
      rightViewMatrix[10] *= -1;
      rightViewMatrix[14] *= -1;
    }

    // Sit-stand transform.
    if (vrDisplay.stageParameters) {
      mat4.copy(sitStand, vrDisplay.stageParameters.sittingToStandingTransform);
    } else {
      mat4.identity(sitStand);
      mat4.translate(sitStand, sitStand, [0, defaultHeight, 0]);
    }
    mat4.transpose(sitStand, sitStand);
    sitStand = Array.from(sitStand);

    // Gamepads.
    if (navigator.getGamepads) {
      gamepads = navigator.getGamepads();
      vrGamepads = [];
      for (var i = 0; i < gamepads.length; ++i) {
        var gamepad = gamepads[i];
        if (gamepad) {
          if (gamepad.pose || gamepad.displayId) {
            if (gamepad.pose.position && gamepad.pose.orientation) {
              // Flip gamepad axis to work with Unity.
              var position = gamepad.pose.position;
              position[2] *= -1;
              var orientation = gamepad.pose.orientation;
              orientation[0] *= -1;
              orientation[1] *= -1;

              vrGamepads.push({
                index: gamepad.index,
                hand: gamepad.hand,
                orientation: Array.from(orientation),
                position: Array.from(position)
              });
            }
          }
        }
      }
    }

    var vrData = {
      leftProjectionMatrix: Array.from(leftProjectionMatrix),
      rightProjectionMatrix: Array.from(rightProjectionMatrix),
      leftViewMatrix: Array.from(leftViewMatrix),
      rightViewMatrix: Array.from(rightViewMatrix),
      sitStand: Array.from(sitStand),
      controllers: vrGamepads
    };

    gameInstance.SendMessage('WebVRCameraSet', 'WebVRData', JSON.stringify(vrData));

    updateStatus();
  }

  function onResize () {
    if (!canvas) {
      return;
    }

    if (inVR) {
      // Scale game container so we get a proper sized mirror of VR content to desktop.
      var renderWidth = canvas.width;
      var renderHeight = canvas.height;
      var scaleX = window.innerWidth / renderWidth;
      var scaleY = window.innerHeight / renderHeight;
      containerEl.setAttribute('style', 'transform: scale(' + scaleX + ',' + scaleY + '); transform-origin: top left;');
    } else {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      containerEl.style.transform = '';
    }
  }

  var keys = {
    27: 'Esc',
    80: 'p',
    86: 'v'
  };

  function onKeyDown (evt) {
    // `Esc` exits VR.
    if (evt.keyCode === keys.Esc) {
      exitVR();
      if (inFullscreen) {
        exitFullscreen();
      }
      return;
    }

    // `p` toggles perf counter.
    if (evt.keyCode === keys.p) {
      gameInstance.SendMessage('WebVRCameraSet', 'TogglePerf');
      return;
    }

    // `v` tests round-trip time between browser and Unity game instance.
    if (evt.keyCode === keys.v) {
      console.log('pressed v, roundtrip time');
      testTimeStart = performance.now();
      gameInstance.SendMessage('WebVRCameraSet', 'TestTime');
    }
  }

  /*
  function showInstruction (el) {
    var confirmButton = el.querySelector('button');
    el.dataset.enabled = true;
    confirmButton.addEventListener('click', onConfirm);
    function onConfirm () {
      el.dataset.enabled = false;
      confirmButton.removeEventListener('click', onConfirm);
    }
  }
  */

  function updateStatus () {
    if (parseInt(statusEl.dataset.gamepads, 10) !== vrGamepads.length) {
      var controlIconsEl = iconsEl.getElementsByClassName(controllerClassName);
      while (controlIconsEl.length > 0) {
        controlIconsEl[0].parentNode.removeChild(controlIconsEl[0]);
      }

      vrGamepads.forEach(function (gamepad) {
        var controllerIconEl = document.importNode(controllerEl.content, true);
        controllerIconEl.querySelector('img').className = controllerClassName;
        iconsEl.appendChild(controllerIconEl);
      });

      statusEl.dataset.gamepads = vrGamepads.length;
    }
  }

  function onRequestAnimationFrame (cb) {
    if (inVR && vrDisplay && vrDisplay.capabilities.canPresent) {
      return vrDisplay.requestAnimationFrame(cb);
    } else {
      return windowRaf(cb);
    }
  }

  function init () {
    // Shim rAF so that we can drive the framerate using the VR display.
    window.requestAnimationFrame = onRequestAnimationFrame;

    // Handle messages from Unity.
    document.addEventListener('Unity', onUnity);

    // Handle `<canvas>` resizing.
    window.addEventListener('resize', onResize, true);

    // Handle keyboard bindings.
    document.addEventListener('keydown', onKeyDown);

    if (enterEl) {
      enterEl.addEventListener('click', enterVR);
    }

    if (webxrHelpEl) {
      webxrHelpEl.addEventListener('click', enterFullscreen);
    }

    if (webxrExitEl) {
      webxrExitEl.addEventListener('click', exitVR);
    }
  }

  init();
})();
