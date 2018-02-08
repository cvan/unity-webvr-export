(function () {
  'use strict';

  var defaultHeight = 1.5;
  var entervrButton = document.querySelector('#entervr');
  var container = document.querySelector('#game');
  var status = document.querySelector('#status');
  var icons = document.querySelector('#icons');
  var controller = document.querySelector('#motion-controller');
  var windowRaf = window.requestAnimationFrame;
  var vrDisplay = null;
  var canvas = null;
  var frameData = null;
  var testTimeStart = null;
  var leftProjectionMatrix = mat4.create();
  var rightProjectionMatrix = mat4.create();
  var leftViewMatrix = mat4.create();
  var rightViewMatrix = mat4.create();
  var sitStand = mat4.create();
  var gamepads = [];
  var vrGamepads = [];

  function onUnity (msg) {
    if (msg.detail === 'Ready') {
      // Get and hide Unity's `<canvas>` element.
      canvas = document.getElementById('#canvas');
      document.body.dataset.unityLoaded = 'true';
      onResize();
      getVRDisplay();
    }

    // Measure the Round-Trip Time (RTT) from Unity.
    if (msg.detail === 'Timer') {
      var delta = performance.now() - testTimeStart;
      console.log('Round-Trip Time (ms): ', delta);
      testTimeStart = null;
    }

    // Wait for Unity to render the frame; then submit to the VR display.
    if (msg.detail === 'PostRender') {
      if (vrDisplay && vrDisplay.isPresenting) {
        vrDisplay.submitFrame();
      }
    }
  }

  function onConnect () {
    console.log('onConnect');
    return getVRDisplay();
  }

  function onToggleVR () {
    console.log('onToggleVR');
    function next (vrDisplay) {
      if (vrDisplay.isPresenting) {
        console.log('Toggling to exit VR mode');
        return onExitPresent();
      } else {
        console.log('Toggling to enter VR mode');
        return onRequestPresent();
      }
    }
    if (vrDisplay) {
      return next(vrDisplay);
    }
    return getVRDisplay().then(next);
  }

  function onRequestPresent () {
    console.log('onRequestPresent');
    function next (vrDisplay) {
      return vrDisplay.requestPresent([{source: canvas}]).then(function () {
        console.log('Entered VR mode');
        // Start stereo rendering in Unity.
        gameInstance.SendMessage('WebVRCameraSet', 'Begin');
      }).catch(function (err) {
        console.log('Failed to enter VR mode:', err);
      });
    }
    if (vrDisplay) {
      return next(vrDisplay);
    }
    return getVRDisplay().then(next);
  }

  function onExitPresent () {
    console.log('onExitPresent');
    function next (vrDisplay) {
      vrDisplay.exitPresent().then(function () {
        console.log('Exited VR mode');
      }).catch(function (err) {
        console.log('Failed to exit VR mode:', err);
      });
      // End stereo rendering in Unity.
      gameInstance.SendMessage('WebVRCameraSet', 'End');
      onResize();
    }
    if (vrDisplay) {
      return next(vrDisplay);
    }
    return getVRDisplay().then(next);
  }

  function onAnimate () {
    // rAF has been shimmed. See `onRequestAnimationFrame` function.
    window.requestAnimationFrame(onAnimate);

    if (vrDisplay) {
      vrDisplay.getFrameData(frameData);

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

      // Sitting-to-Standing Transform.
      if (vrDisplay.stageParameters) {
        mat4.copy(sitStand, vrDisplay.stageParameters.sittingToStandingTransform);
      } else {
        mat4.identity(sitStand);
        mat4.translate(sitStand, sitStand, [0, defaultHeight, 0]);
      }
      mat4.transpose(sitStand, sitStand);

      // Gamepads.
      gamepads = navigator.getGamepads();
      vrGamepads = [];

      for (var i = 0; i < gamepads.length; ++i) {
        var gamepad = gamepads[i];
        if (gamepad && (gamepad.pose || gamepad.displayId)) {
          if (gamepad.pose.position && gamepad.pose.orientation) {
            // Flip gamepad axis to be compatible with Unity.
            var position = gamepad.pose.position;
            position[2] *= -1;
            var linearVelocity = gamepad.pose.linearVelocity;
            linearVelocity[2] *= -1;
            var angularVelocity = gamepad.pose.angularVelocity;
            angularVelocity[2] *= -1;
            var orientation = gamepad.pose.orientation;
            orientation[0] *= -1;
            orientation[1] *= -1;

            var buttons = [];
            for (var j = 0; j < gamepad.buttons.length; j++) {
              buttons.push({
                pressed: gamepad.buttons[j].pressed,
                touched: gamepad.buttons[j].touched,
                value: gamepad.buttons[j].value
              });
            }

            vrGamepads.push({
              index: gamepad.index,
              hand: gamepad.hand,
              buttons: buttons,
              orientation: Array.from(orientation),
              position: Array.from(position),
              linearVelocity: Array.from(linearVelocity),
              angularVelocity: Array.from(angularVelocity)
            });

            console.log(linearVelocity, angularVelocity);
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
  }

  function onResize () {
    if (!canvas) {
      return;
    }

    if (vrDisplay && vrDisplay.isPresenting) {
      var leftEye = vrDisplay.getEyeParameters('left');
      var rightEye = vrDisplay.getEyeParameters('right');
      var renderWidth = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
      var renderHeight = Math.max(leftEye.renderHeight, rightEye.renderHeight);
      canvas.width = renderWidth;
      canvas.height = renderHeight;

      // Scale the game container so we get a properly sized mirrored canvas of the VR content on the PC.
      var scaleX = window.innerWidth / renderWidth;
      var scaleY = window.innerHeight / renderHeight;
      container.setAttribute('style', `transform: scale(${scaleX}, ${scaleY}); transform-origin: top left;`);
    } else {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      container.style.transform = '';
    }
  }

  function togglePerf () {
    gameInstance.SendMessage('WebVRCameraSet', 'TogglePerf');
  }

  function testRoundtripTime () {
    console.log('Testing roundtrip time …');
    testTimeStart = performance.now();
    gameInstance.SendMessage('WebVRCameraSet', 'TestTime');
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
    if (parseInt(status.dataset.gamepads) !== vrGamepads.length) {
      var controllerClassName = 'controller-icon';
      var controlIcons = icons.getElementsByClassName(controllerClassName);
      while (controlIcons.length > 0) {
        controlIcons[0].parentNode.removeChild(controlIcons[0]);
      }

      vrGamepads.forEach(function (gamepad) {
        var controllerIcon = document.importNode(controller.content, true);
        controllerIcon.querySelector('img').className = controllerClassName;
        icons.appendChild(controllerIcon);
      })
      status.dataset.gamepads = vrGamepads.length;
    }
  }

  // Unity drives its rendering from the window RAF, so we'll reassign to use `VRDisplay`'s rAF
  // when presenting so that Unity renders at the appropriate VR framerate.
  function onRequestAnimationFrame (cb) {
    if (vrDisplay && vrDisplay.isPresenting) {
      return vrDisplay.requestAnimationFrame(cb);
    } else {
      return windowRaf(cb);
    }
  }

  function getVRDisplay () {
    if (vrDisplay) {
      return Promise.resolve(vrDisplay);
    }

    frameData = new VRFrameData();

    if (!navigator.getVRDisplays) {
      var msg = 'Your browser does not support WebVR';
      console.warn(msg);
      return Promise.reject(new Error(msg));
    }

    return navigator.getVRDisplays().then(function (displays) {
      if (!displays.length) {
        return null;
      }

      vrDisplay = displays[displays.length - 1];

      // Check to see if the VR display is polyfilled (i.e., from the `webvr-polyfill` library).
      var isPolyfilled = (vrDisplay.deviceId || '').indexOf('polyfill') > 0 ||
        (vrDisplay.displayName || '').indexOf('polyfill') > 0 ||
        (vrDisplay.deviceName || '').indexOf('polyfill') > 0 ||
        vrDisplay.hardwareUnitId;

      if (isPolyfilled) {
        showInstruction(document.querySelector('#novr'));
      } else {
        status.dataset.enabled = 'true';
      }

      // Enable the "Enter VR" button.
      if (vrDisplay.capabilities.canPresent) {
        entervrButton.dataset.enabled = 'true';
      }

      return vrDisplay;
    });
  }

  // Monkeypatch rAF so that we can drive the framerate at the VR display's framerate.
  window.requestAnimationFrame = onRequestAnimationFrame;

  window.addEventListener('resize', onResize, true);
  window.addEventListener('vrdisplayconnected', onConnect, false);
  window.addEventListener('vrdisplaypresentchange', onResize, false);
  window.addEventListener('vrdisplayactivate', onRequestPresent, false);
  window.addEventListener('vrdisplaydeactivate', onExitPresent, false);
  document.addEventListener('Unity', onUnity);
  entervrButton.addEventListener('click', onToggleVR, false);
  onResize();
  window.requestAnimationFrame(onAnimate);
})();
