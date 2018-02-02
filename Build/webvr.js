/* global gameInstance, mat4, Promise, VRFrameData */
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
  var framesSent = 0;
  var framesRendered = 0;

  function onUnity (msg) {
    var detail = msg.detail;
    if (detail === 'Ready') {
      // Get and hide Unity's canvas instance.
      canvas = document.getElementById('#canvas');
      document.body.dataset.unityLoaded = 'true';
      onResize();
      getVRDisplays();
      return;
    }

    // Measures Round-Trip Time from Unity.
    if (detail === 'Timer') {
      var delta = performance.now() - testTimeStart;
      console.log('return time (ms): ',delta);
      testTimeStart = null;
      return;
    }

    // Wait for Unity to render frame, then submit to `vrDisplay`.
    if (detail === 'PreRender') {
      // if (vrDisplay && vrDisplay.isPresenting) {
        framesSent++;
      // }
      return;
    }

    if (detail === 'PostRender') {
      // if (vrDisplay && vrDisplay.isPresenting) {
        framesRendered++;
      // }
    }
  }

  function onToggleVR () {
    if (vrDisplay.isPresenting) {
      console.log('Toggle exit present');
      onExitPresent();
      return;
    }
    console.log('Toggle present');
    onRequestPresent();
  }

  function onRequestPresent () {
    vrDisplay.requestPresent([{source: canvas}]).then(function () {
      console.log('Successfully presented to VR');
      // Start stereo rendering in Unity.
      gameInstance.SendMessage('WebVRCameraSet', 'Begin');
    });
  }

  function onExitPresent () {
    vrDisplay.exitPresent().then(function (err) {
      console.error('Failed to present to VR', err);
    });
    // End stereo rendering in Unity.
    gameInstance.SendMessage('WebVRCameraSet', 'End');
    onResize();
  }

  function drawScene () {
    if (!vrDisplay) {
      window.requestAnimationFrame(drawScene);
      updateStatus();
      return;
    }

    if (vrDisplay.isPresenting) {
      vrDisplay.requestAnimationFrame(drawScene);
    }

    vrDisplay.getFrameData(frameData);

    // Convert view and projection matrices to be compatible with Unity's.
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

    // Poll the gamepads.
    gamepads = navigator.getGamepads();
    vrGamepads = [];
    for (var i = 0; i < gamepads.length; ++i) {
      var gamepad = gamepads[i];
      if (gamepad && (gamepad.pose || gamepad.displayId) && gamepad.pose.position && gamepad.pose.orientation) {
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

    if (vrDisplay.isPresenting) {
      var vrData = {
        leftProjectionMatrix: Array.from(leftProjectionMatrix),
        rightProjectionMatrix: Array.from(rightProjectionMatrix),
        leftViewMatrix: Array.from(leftViewMatrix),
        rightViewMatrix: Array.from(rightViewMatrix),
        sitStand: Array.from(sitStand),
        controllers: vrGamepads
      };
      gameInstance.SendMessage('WebVRCameraSet', 'WebVRData', JSON.stringify(vrData));
      console.log('•', framesSent, framesRendered);
      // if (framesSent === framesRendered) {
        vrDisplay.submitFrame();
      // }
    }

    updateStatus();
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

      // Scale game container so we get a properly sized mirror of VR content to desktop.
      var scaleX = window.innerWidth / renderWidth;
      var scaleY = window.innerHeight / renderHeight;
      container.setAttribute('style', 'transform: scale(' + scaleX + ', ' + scaleY + '}); transform-origin: top left;');
    } else {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      container.style.transform = '';
    }
  }

  var keys = {
    p: 80,
    v: 86
  }

  function onKeyDown (e) {
    if (e.keyCode === keys.p) {  // `p` toggles performance counter.
      gameInstance.SendMessage('WebVRCameraSet', 'TogglePerf');
    } else if (e.keyCode === keys.v) {  // `v` tests round-trip time between the browser and instance of the Unity game.
      console.log('pressed v, roundtrip time');
      testTimeStart = window.performance.now();
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
  }

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
      });
      status.dataset.gamepads = vrGamepads.length;
    }
  }

  // // Unity drives its rendering from the window `rAF`; we'll reassign to use `VRDisplay`'s `rAF` when presenting
  // // such that Unity renders at the appropriate VR framerate.
  function onRequestAnimationFrame (cb) {
    if (vrDisplay && vrDisplay.isPresenting) {
      return vrDisplay.requestAnimationFrame(cb);
    } else {
      return windowRaf(cb);
    }
  }

  function isDevicePolyfilled (device) {
    // Check to see if the VR device is polyfilled
    // (i.e, using `webvr-polyfill`: https://github.com/googlevr/webvr-polyfill).
    if (!device) {
      return false;
    }

    // Feature detecting: https://github.com/immersive-web/cardboard-vr-display/blob/master/src/base.js
    return device.isPolyfilled ||
      (device.deviceId || '').indexOf('polyfill') > 0 ||
      (device.displayName || '').indexOf('polyfill') > 0 ||
      (device.deviceName || '').indexOf('polyfill') > 0 ||
      device.hardwareUnitId;
  }

  function getVRDisplays () {
    if (!navigator.getVRDisplays) {
      var msg = 'Your browser does not support WebVR!';
      console.error(msg);
      if ('Promise' in window) {
        return Promise.reject(msg);
      }
    }

    frameData = new VRFrameData();

    var gotDevice = navigator.getVRDisplays().then(function (displays) {
      if (displays && displays.length > 0) {
        return displays[displays.length - 1];
      }
      return null;
    });

    return gotDevice.then(function (display) {
      vrDisplay = display;

      if (isDevicePolyfilled(display)) {
        showInstruction(document.querySelector('#novr'));
      } else {
        status.dataset.enabled = 'true';
      }

      // Enables "Enter VR" button.
      if (vrDisplay.capabilities.canPresent) {
        entervrButton.dataset.enabled = 'true';
      }

      return display;
    });
  }

  // shim `rAF` so that we can drive the framerate using the VR device.
  window.requestAnimationFrame = onRequestAnimationFrame;

  window.addEventListener('resize', onResize, true);
  window.addEventListener('vrdisplaypresentchange', onResize, false);
  window.addEventListener('vrdisplayactivate', onRequestPresent, false);
  window.addEventListener('vrdisplaydeactivate', onExitPresent, false);
  document.addEventListener('Unity', onUnity);
  document.addEventListener('keydown', onKeyDown);
  entervrButton.addEventListener('click', onToggleVR, false);
  onResize();
  window.requestAnimationFrame(drawScene);
})();
