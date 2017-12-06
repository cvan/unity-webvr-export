/* global performance, webvrui */
(function () {
  'use strict';

  var defaultHeight = 1.5;
  var enterEl = document.querySelector('#entervr');
  var container = document.querySelector('#game');
  var loaderEl = document.querySelector('#loader');
  var statusEl = document.getElementById('webxr__status');
  var icons = document.getElementById('#icons');
  var controller = document.querySelector('#motion-controller');
  var windowRaf = window.requestAnimationFrame;
  var vrDisplay = null;
  var canvas = null;
  var frameData = null;
  var inVR = false;
  var isPresenting = false;
  var testTimeStart = null;
  var leftProjectionMatrix = mat4.create();
  var rightProjectionMatrix = mat4.create();
  var leftViewMatrix = mat4.create();
  var rightViewMatrix = mat4.create();
  var sitStand = mat4.create();
  var gamepads = [];
  var vrGamepads = [];

  var webxrUIEl = document.getElementById('webxr__ui');
  var webxrHelpEl = document.getElementById('webxr__help');
  var exitEl = document.getElementById('webxr__exit');
  var learnEl = document.getElementById('webxr__learn');
  var webxrButtonEl = document.getElementById('webxr__button');
  var webxrButtonUI

  var webxrButtonUI = new webvrui.EnterVRButton(renderer.domElement, {
    color: '#111',
    background: '#fff',
    corners: 'round'
  }).on('enter', function () {
    console.log('enter VR');
  }).on('exit', function () {
    console.log('exit VR');
  }).on('error', function (err) {
    learnEl.style.display = 'inline';
    console.error(error)
  })
  .on('hide', function () {
      webxrUIEl.classList.add('hidden');
      // On iOS there is no button to close fullscreen mode, so we need to provide one.
      if (enterVR.state == webvrui.State.PRESENTING_FULLSCREEN) {
        exitEl.style.display = 'initial';
      }
  })
  .on('show', function () {
    webxrUIEl.classList.remove('hidden');
    exitEl.style.display = 'none';
  });
  webxrButtonEl.appendChild(uiButton.domElement);

  function onReady () {
    if (!navigator.getVRDisplays) {
      console.warn('Your browser does not support WebVR!');
      return;
    }
    return navigator.getVRDisplays().then(function (displays) {
      if (!Array.isArray(displays)) {
        vrDisplay = displays;
      }
      if (displays.length) {
        vrDisplay = displays[displays.length - 1];
      }
      if (!vrDisplay) {
        return;
      }



      // Check to see if we are polyfilled.
      if (vrDisplay.isPolyfilled) {
        // showInstruction(document.querySelector('#novr'));
      } else {
        statusEl.dataset.enabled = true;
      }
      onResize();
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

  function exitVR (force) {
    if (!force && !inVR) {
      enterVR();
      return();
    }
    inVR = false;
    if (uiButton) {
      uiButton.requestExit();
    }
    if (vrDisplay.isPresenting) {
      vrDisplay.exitPresent();
      isPresenting = false;
    }

    // Start stereo rendering in Unity.
    gameInstance.SendMessage('WebVRCameraSet', 'End');

    onResize();
  }

  function enterFullscreen (force) {
    if (!force && inFullscreen) {
      return Promise.resolve(new Error('Already in fullscreen'));
    }
    if (!uiButton) {
      throw new Error('Could not find `uiButton` for entering fullscreen');
    }
    return uiButton.requestEnterFullscreen();
  });

  function enterVR (force) {
    if (!force && inVR) {
      exitVR();
      return;
    }

    inVR = true;
    if (vrDisplay.capabilities && vrDisplay.capabilities.canPresent) {
      return vrDisplay.requestPresent([
        {source: canvas}
      ]).then(function () {
        var leftEye = vrDisplay.getEyeParameters('left');
        var rightEye = vrDisplay.getEyeParameters('right');
        var renderWidth = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
        var renderHeight = Math.max(leftEye.renderHeight, rightEye.renderHeight);
        canvas.width = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
        canvas.height = Math.max(leftEye.renderHeight, rightEye.renderHeight);
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
      container.setAttribute('style', `transform: scale(${scaleX}, ${scaleY}); transform-origin: top left;`);
    } else {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      container.style.transform = '';
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

  function showInstruction (el) {
    var confirmButton = el.querySelector('button');
    el.dataset.enabled = true;
    confirmButton.addEventListener('click', onConfirm);
    function onConfirm () {
      el.dataset.enabled = false;
      confirmButton.removeEventListener('click', onConfirm);
    }
  };

  function updateStatus () {
    if (parseInt(statusEl.dataset.gamepads, 10) !== vrGamepads.length) {
      var controllerClassName = 'controller-icon';
      var controlIcons = icons.getElementsByClassName(controllerClassName);
      while (controlIcons.length > 0) {
        controlIcons[0].parentNode.removeChild(controlIcons[0]);
      };

      vrGamepads.forEach(function (gamepad, i) {
        var controllerIcon = document.importNode(controller.content, true);
        controllerIcon.querySelector('img').className = controllerClassName;
        icons.appendChild(controllerIcon);
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

    if (exitEl) {
      exitEl.addEventListener('click', exitVR);
    }
  }

  init();
})();
