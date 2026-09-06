// 09-characters.js - the stylised humanoid used by the player, pedestrians and
// police, plus its procedural animation. No skinning: it is a small rig of
// boxes parented into a skeleton and posed each frame from a phase value.
(function (SB) {
  'use strict';

  var M = SB.M;

  var SKIN = [0xf0c8a0, 0xdba97c, 0xb07f52, 0x8a5a34, 0x5d3a20, 0xf5d5b5];
  var SHIRT = [0x2b4c7e, 0x8f2b2b, 0x2f6b4a, 0xd8d3c6, 0x3a3d44, 0xc27c2a, 0x6a4a86, 0x1d2027, 0xb8452f, 0x4f6d8c];
  var PANTS = [0x2a2f3a, 0x3d3a33, 0x1e2128, 0x54504a, 0x2b3d5c, 0x4a4a4a];
  var HAIR = [0x1a1410, 0x3b2a1a, 0x6b4a2a, 0x8a6a3a, 0x2a2a2a, 0xa08050];

  function box(w, h, d, color, mat) {
    var g = new THREE.BoxGeometry(w, h, d);
    var m = new THREE.Mesh(g, mat || new THREE.MeshStandardMaterial({ color: color, roughness: 0.82 }));
    m.castShadow = true;
    return m;
  }

  // The original rig used hard-edged boxes for every body part. Keep boxes
  // for clothing details, but use smooth, low-poly forms for the anatomy so
  // faces, shoulders, elbows and knees catch light like actual rounded forms.
  function capsule(radius, length, material, radial, caps) {
    if (THREE.CapsuleGeometry) {
      var g = new THREE.CapsuleGeometry(radius, Math.max(0.01, length), caps || 3, radial || 10);
      var m = new THREE.Mesh(g, material);
      m.castShadow = true;
      return m;
    }
    return box(radius * 2, length + radius * 2, radius * 2, 0, material);
  }

  function sphere(rx, ry, rz, material) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), material);
    m.scale.set(rx, ry, rz);
    m.castShadow = true;
    return m;
  }

  // A limb segment hinged at its top, so rotating the pivot swings it properly.
  function limb(w, h, d, mat) {
    var pivot = new THREE.Group();
    var radius = Math.min(w, d) * 0.48;
    var m = capsule(radius, Math.max(0.02, h - radius * 2), mat, 10, 3);
    m.scale.x = w / (radius * 2);
    m.scale.z = d / (radius * 2);
    m.position.y = -h / 2;
    pivot.add(m);
    pivot.userData.len = h;
    return pivot;
  }

  var matCache = Object.create(null);
  function mat(color, rough) {
    var k = color + ':' + (rough || 0.82);
    return matCache[k] || (matCache[k] = new THREE.MeshStandardMaterial({
      color: color, roughness: rough === undefined ? 0.82 : rough
    }));
  }

  // opts: { skin, shirt, pants, hair, hat, scale, cop, swat }
  function Character(opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var skin = opts.skin !== undefined ? opts.skin : SKIN[Math.floor(rng() * SKIN.length)];
    var shirt = opts.shirt !== undefined ? opts.shirt : SHIRT[Math.floor(rng() * SHIRT.length)];
    var pants = opts.pants !== undefined ? opts.pants : PANTS[Math.floor(rng() * PANTS.length)];
    var hair = opts.hair !== undefined ? opts.hair : HAIR[Math.floor(rng() * HAIR.length)];
    var beard = opts.beard !== undefined ? opts.beard : rng() < 0.28;

    var S = opts.scale || (0.94 + (rng() * 0.14));
    this.scale = S;
    this.height = 1.80 * S;

    var root = this.root = new THREE.Group();
    var body = this.body = new THREE.Group();      // yaw-able upper body
    root.add(body);

    var skinM = mat(skin, 0.75), shirtM = mat(shirt), pantsM = mat(pants), hairM = mat(hair, 0.9);
    var shoeM = mat(0x17191d, 0.62), soleM = mat(0x090a0c, 0.95);
    var eyeM = mat(0xf3f1e8, 0.32), pupilM = mat(0x14171c, 0.42);
    var lipM = mat(0x7f3d3b, 0.62), metalM = mat(0xb2a67f, 0.32);

    // hips at ~0.92m, everything measured from there
    var hipY = 0.92 * S;
    this.hipY = hipY;

    var pelvis = this.pelvis = new THREE.Group();
    pelvis.position.y = hipY;
    body.add(pelvis);

    var torso = this.torso = new THREE.Group();
    pelvis.add(torso);

    // Build varies per character: the same rig reads as a different person at
    // 0.88 and at 1.14, and a crowd of identically-shaped people is the thing
    // that gives a procedural city away fastest.
    var build = opts.build !== undefined ? opts.build : (0.90 + rng() * 0.24);
    this.build = build;

    // Local +x is FORWARD and local z is the lateral axis. A human torso is
    // wider across the shoulders than it is deep, so the depth axis is the one
    // to squash. The rig had these the wrong way round: the chest came out
    // 0.38 m deep and 0.23 m across, a slab facing forward, and the arms had
    // to be hung out in clear air to clear it. Everything below that looked
    // detached followed from this one line.
    var chest = capsule(0.183 * S * build, 0.19 * S, shirtM, 12, 4);
    chest.scale.x = 0.60;
    chest.position.y = 0.28 * S;
    torso.add(chest);
    // Shoulder caps bridge the torso to the arm sockets. Without them the arm
    // is a floating cylinder no matter how close in it is placed.
    // The arm has to hang OUTSIDE the chest silhouette, so the socket sits a
    // little past the chest half-width rather than inside it.
    var shoulderZ = 0.196 * S * build;
    for (var sh = -1; sh <= 1; sh += 2) {
      var delt = sphere(0.072 * S, 0.086 * S, 0.088 * S, shirtM);
      delt.position.set(0, 0.505 * S, sh * shoulderZ);
      torso.add(delt);
    }
    var neckMesh = capsule(0.052 * S, 0.055 * S, skinM, 8, 2);
    neckMesh.position.y = 0.585 * S;
    torso.add(neckMesh);

    var hipsMesh = sphere(0.135 * S, 0.145 * S, 0.180 * S * build, pantsM);
    hipsMesh.position.y = -0.055 * S;
    pelvis.add(hipsMesh);

    // Collar, belt and shirt placket make the body read as layered clothing
    // instead of one unbroken primitive at medium distance.
    var collar = new THREE.Mesh(new THREE.TorusGeometry(0.088 * S, 0.022 * S, 6, 16), shirtM);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(0.78, 1.32, 1);
    collar.position.set(0.005 * S, 0.545 * S, 0);
    torso.add(collar);
    var belt = box(0.25 * S, 0.05 * S, 0.38 * S * build, 0, mat(0x29231e, 0.68));
    belt.position.y = 0.045 * S;
    pelvis.add(belt);
    var buckle = box(0.045 * S, 0.055 * S, 0.075 * S, 0, metalM);
    buckle.position.set(0.128 * S, 0.045 * S, 0);
    pelvis.add(buckle);

    // neck + head
    var neck = this.neck = new THREE.Group();
    neck.position.y = 0.58 * S;
    torso.add(neck);
    var head = this.head = sphere(0.115 * S, 0.145 * S, 0.12 * S, skinM);
    head.position.y = 0.13 * S;
    neck.add(head);
    // Hair styles: a close crop, a fuller cut that comes down over the ears,
    // and bald. One shell each, following the head's ellipsoid rather than
    // sitting on it as a perfect sphere.
    var hairStyle = opts.hairStyle !== undefined ? opts.hairStyle
      : (rng() < 0.12 ? 'bald' : (rng() < 0.42 ? 'long' : 'crop'));
    this.hairStyle = hairStyle;
    if (hairStyle !== 'bald') {
      // One shell cannot do a haircut. Swept far enough to cover the back and
      // sides it also comes down over the eyes, and swept short enough to
      // clear the brow it leaves the back of the head bald. So: a crown cap
      // that stops above the brow line all the way round, plus a back-and-
      // sides piece that comes lower with the face left open. phi is the
      // horizontal sweep and the face sits at phi = PI/2, so excluding a
      // wedge there is what keeps the fringe off the eyes.
      // The hairline lands at cos(capSweep) up the skull. At 0.40 it came down
      // level with the brow and buried the eyes; a real hairline sits about
      // three quarters of the way up the head.
      var HAIR_R = 0.126 * S, capSweep = 0.33;
      var crown = new THREE.Mesh(
        new THREE.SphereGeometry(HAIR_R, 18, 10, 0, Math.PI * 2, 0, Math.PI * capSweep), hairM);
      crown.scale.set(0.99, 1.16, 1.02);
      crown.position.y = 0.135 * S;
      neck.add(crown);

      var backSweep = hairStyle === 'long' ? 0.74 : 0.58;
      var faceGap = hairStyle === 'long' ? 0.56 : 0.66;
      var sides = new THREE.Mesh(
        new THREE.SphereGeometry(HAIR_R, 18, 12,
          Math.PI * 0.5 + faceGap, Math.PI * 2 - faceGap * 2,
          Math.PI * capSweep * 0.94, Math.PI * (backSweep - capSweep * 0.94)), hairM);
      sides.scale.set(0.99, 1.16, 1.02);
      sides.position.y = 0.135 * S;
      neck.add(sides);
    }
    // Small facial planes are cheap, but dramatically improve close third
    // person shots: eyes sit under a brow, the nose projects forward, and the
    // mouth gives the face a readable front even under sunset lighting.
    // The features were all built about 50% oversized against a head of
    // radius 0.115: eyes a fifth of the face wide, brows broad enough to meet
    // in the middle, and a nose that stood proud of the profile. At any
    // distance it read as a caricature rather than a person. These are sized
    // off real proportions - eye width about a fifth of head width, set one
    // eye-width apart - and sunk into the surface rather than stuck onto it.
    for (var eyeSide = -1; eyeSide <= 1; eyeSide += 2) {
      var eye = sphere(0.017 * S, 0.019 * S, 0.015 * S, eyeM);
      eye.position.set(0.099 * S, 0.150 * S, eyeSide * 0.046 * S);
      neck.add(eye);
      var pupil = sphere(0.008 * S, 0.010 * S, 0.008 * S, pupilM);
      pupil.position.set(0.111 * S, 0.150 * S, eyeSide * 0.046 * S);
      neck.add(pupil);
      var brow = box(0.022 * S, 0.008 * S, 0.034 * S, 0, hairM);
      brow.position.set(0.098 * S, 0.174 * S, eyeSide * 0.047 * S);
      brow.rotation.x = eyeSide * 0.10;
      neck.add(brow);
      var ear = sphere(0.014 * S, 0.030 * S, 0.012 * S, skinM);
      ear.position.set(-0.004 * S, 0.133 * S, eyeSide * 0.114 * S);
      neck.add(ear);
    }
    var nose = sphere(0.024 * S, 0.030 * S, 0.019 * S, skinM);
    nose.position.set(0.111 * S, 0.124 * S, 0);
    neck.add(nose);
    var mouth = box(0.012 * S, 0.009 * S, 0.038 * S, 0, lipM);
    mouth.position.set(0.109 * S, 0.086 * S, 0);
    neck.add(mouth);
    if (beard) {
      // phiStart/phiLength restrict the shell to the front of the head: a full
      // horizontal sweep put a beard around the back of the skull as well.
      var beardMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.106 * S, 16, 10,
          Math.PI * 0.5 - 0.62, 1.24, Math.PI * 0.54, Math.PI * 0.23), hairM);
      beardMesh.position.set(0.014 * S, 0.096 * S, 0);
      beardMesh.scale.set(1.0, 1.15, 0.96);
      neck.add(beardMesh);
    }

    if (opts.hat) {
      var cap = box(0.24 * S, 0.07 * S, 0.25 * S, 0, mat(opts.hat, 0.7));
      cap.position.y = 0.27 * S;
      neck.add(cap);
      var brim = box(0.11 * S, 0.03 * S, 0.24 * S, 0, mat(opts.hat, 0.7));
      brim.position.set(0.15 * S, 0.24 * S, 0);
      neck.add(brim);
    }

    // arms - hung from the shoulder cap, not out in space beside it
    this.armL = limb(0.098 * S, 0.30 * S, 0.104 * S, shirtM);
    this.armR = limb(0.098 * S, 0.30 * S, 0.104 * S, shirtM);
    this.armL.position.set(0, 0.505 * S, -shoulderZ);
    this.armR.position.set(0, 0.505 * S, shoulderZ);
    torso.add(this.armL, this.armR);
    this.foreL = limb(0.086 * S, 0.28 * S, 0.092 * S, skinM);
    this.foreR = limb(0.086 * S, 0.28 * S, 0.092 * S, skinM);
    this.foreL.position.y = -0.30 * S;
    this.foreR.position.y = -0.30 * S;
    this.armL.add(this.foreL);
    this.armR.add(this.foreR);
    // A cuff at the elbow turns the shirt-to-skin colour change into a short
    // sleeve ending, instead of an arm that appears to be two materials.
    for (var cuffSide = 0; cuffSide < 2; cuffSide++) {
      var cuff = capsule(0.056 * S, 0.018 * S, shirtM, 10, 2);
      cuff.scale.set(1.06, 1, 1.06);
      cuff.position.y = -0.298 * S;
      (cuffSide ? this.armR : this.armL).add(cuff);
      var elbow = sphere(0.048 * S, 0.048 * S, 0.048 * S, skinM);
      elbow.position.y = -0.012 * S;
      (cuffSide ? this.foreR : this.foreL).add(elbow);
    }

    // legs - brought in under the hips and capped at the joint
    var hipZ = 0.088 * S * build;
    this.legL = limb(0.122 * S, 0.44 * S, 0.128 * S, pantsM);
    this.legR = limb(0.122 * S, 0.44 * S, 0.128 * S, pantsM);
    this.legL.position.set(0, -0.085 * S, -hipZ);
    this.legR.position.set(0, -0.085 * S, hipZ);
    pelvis.add(this.legL, this.legR);
    for (var hipSide = 0; hipSide < 2; hipSide++) {
      var thighTop = sphere(0.070 * S, 0.072 * S, 0.072 * S, pantsM);
      (hipSide ? this.legR : this.legL).add(thighTop);
      var knee = sphere(0.058 * S, 0.058 * S, 0.058 * S, pantsM);
      knee.position.y = -0.008 * S;
      (hipSide ? this.shinRPending = knee : this.shinLPending = knee);
    }
    this.shinL = limb(0.12 * S, 0.42 * S, 0.13 * S, pantsM);
    this.shinR = limb(0.12 * S, 0.42 * S, 0.13 * S, pantsM);
    this.shinL.position.y = -0.44 * S;
    this.shinR.position.y = -0.44 * S;
    this.legL.add(this.shinL);
    this.legR.add(this.shinR);
    if (this.shinLPending) { this.shinL.add(this.shinLPending); this.shinLPending = null; }
    if (this.shinRPending) { this.shinR.add(this.shinRPending); this.shinRPending = null; }
    var footL = capsule(0.065 * S, 0.11 * S, shoeM, 9, 3);
    var footR = capsule(0.065 * S, 0.11 * S, shoeM, 9, 3);
    footL.scale.x = 1.8; footL.scale.z = 1.0;
    footR.scale.x = 1.8; footR.scale.z = 1.0;
    footL.position.set(0.05 * S, -0.42 * S, 0);
    footR.position.set(0.05 * S, -0.42 * S, 0);
    this.shinL.add(footL);
    this.shinR.add(footR);
    var soleL = box(0.25 * S, 0.025 * S, 0.14 * S, 0, soleM);
    var soleR = box(0.25 * S, 0.025 * S, 0.14 * S, 0, soleM);
    soleL.position.set(0.05 * S, -0.475 * S, 0);
    soleR.position.set(0.05 * S, -0.475 * S, 0);
    this.shinL.add(soleL); this.shinR.add(soleR);

    if (opts.vest) {
      // Same axis correction as the chest: a body-armour plate is broad and
      // shallow, not deep and narrow.
      var vest = box(0.27 * S, 0.40 * S, 0.42 * S * build, 0, mat(opts.vest, 0.7));
      vest.position.y = 0.30 * S;
      torso.add(vest);
    }

    // contact shadow
    var sg = new THREE.PlaneGeometry(0.9 * S, 0.9 * S);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
      map: SB.Tex.blob(), color: 0x000000, transparent: true,
      opacity: 0.35, depthWrite: false
    }));
    this.shadow.position.y = 0.03;
    root.add(this.shadow);

    // weapon, attached to the right hand
    this.hand = new THREE.Group();
    this.hand.position.y = -0.28 * S;
    this.foreR.add(this.hand);
    this.weaponMesh = null;
    var handL = sphere(0.052 * S, 0.062 * S, 0.040 * S, skinM);
    var handR = sphere(0.052 * S, 0.062 * S, 0.040 * S, skinM);
    handL.position.y = -0.295 * S; handR.position.y = -0.295 * S;
    this.foreL.add(handL); this.foreR.add(handR);

    this.phase = 0;
    this.state = 'idle';
    this.aim = 0;
    this.lean = 0;
    this.deathT = 0;
  }

  Character.prototype.setWeapon = function (mesh) {
    if (this.weaponMesh) this.hand.remove(this.weaponMesh);
    this.weaponMesh = mesh;
    if (mesh) this.hand.add(mesh);
  };

  // speed in m/s, dt seconds. `aim` 0..1 blends to a two-handed aiming pose.
  Character.prototype.animate = function (dt, speed, opts) {
    opts = opts || {};
    var S = this.scale;

    if (this.state === 'dead') {
      this.deathT = Math.min(1, this.deathT + dt * 2.6);
      var t = M.smoothstep(this.deathT);
      this.root.rotation.z = -t * Math.PI / 2 * 0.92;
      this.root.position.y = this.baseY - t * 0.10;
      this.pelvis.rotation.set(0, 0, 0);
      this.torso.rotation.set(0, 0, t * 0.3);
      this.armL.rotation.set(0, 0, -t * 1.1);
      this.armR.rotation.set(0, 0, t * 0.7);
      this.legL.rotation.set(t * 0.5, 0, 0);
      this.legR.rotation.set(-t * 0.3, 0, 0);
      this.shadow.material.opacity = 0.35 * (1 - t * 0.4);
      return;
    }

    if (this.state === 'sit') {
      this.pelvis.rotation.set(0, 0, 0);
      this.torso.rotation.set(0, 0, -0.10);
      this.legL.rotation.set(0, 0, -1.35);
      this.legR.rotation.set(0, 0, -1.35);
      this.shinL.rotation.set(0, 0, 1.30);
      this.shinR.rotation.set(0, 0, 1.30);
      this.armL.rotation.set(0.35, 0, -0.75);
      this.armR.rotation.set(-0.35, 0, -0.75);
      this.foreL.rotation.set(0, 0, -0.55);
      this.foreR.rotation.set(0, 0, -0.55);
      this.neck.rotation.set(0, 0, 0);
      this.shadow.visible = false;
      return;
    }
    if (this.state === 'swim') {
      // A buoyant front-crawl pose keeps the avatar from looking like a
      // standing pedestrian while the swim controller moves their chest
      // through the water volume.
      this.shadow.visible = false;
      this.root.rotation.z = 0;
      this.phase += dt * (speed > 0.2 ? 7.0 : 2.0);
      var swimP = this.phase;
      var stroke = Math.sin(swimP);
      this.pelvis.rotation.set(0.12, 0, 0);
      this.torso.rotation.set(-0.28, 0, 0);
      this.head.rotation.set(0.18, 0, 0);
      this.armL.rotation.set(-0.22 + stroke * 0.72, 0.10, -0.42);
      this.armR.rotation.set(-0.22 - stroke * 0.72, -0.10, 0.42);
      this.foreL.rotation.set(0.18 - stroke * 0.60, 0, -0.16);
      this.foreR.rotation.set(0.18 + stroke * 0.60, 0, 0.16);
      this.legL.rotation.set(0.24 - stroke * 0.28, 0, -0.08);
      this.legR.rotation.set(0.24 + stroke * 0.28, 0, 0.08);
      this.shinL.rotation.set(-0.18 + stroke * 0.22, 0, 0);
      this.shinR.rotation.set(-0.18 - stroke * 0.22, 0, 0);
      return;
    }
    this.shadow.visible = true;

    var moving = speed > 0.25;
    var stride = M.clamp(speed / 5.2, 0, 1.35);
    var freq = moving ? M.lerp(4.6, 9.4, M.clamp(speed / 6.5, 0, 1)) : 1.4;
    this.phase += dt * freq;
    var p = this.phase;
    var sw = Math.sin(p), sw2 = Math.sin(p * 2);

    var aim = this.aim = M.damp(this.aim, opts.aim || 0, 14, dt);
    var swing = stride * 0.95;

    // legs
    this.legL.rotation.z = 0;
    this.legR.rotation.z = 0;
    this.legL.rotation.x = 0;
    this.legR.rotation.x = 0;
    // limbs swing about the character's local Z (side axis) because the rig
    // faces +x, matching the vehicle convention
    this.legL.rotation.z = -sw * swing;
    this.legR.rotation.z = sw * swing;
    this.shinL.rotation.z = Math.max(0, Math.sin(p + 0.6)) * swing * 1.15;
    this.shinR.rotation.z = Math.max(0, Math.sin(p + Math.PI + 0.6)) * swing * 1.15;

    // arms: swing when running, tuck up when aiming
    var armSwing = swing * 0.72 * (1 - aim);
    this.armL.rotation.z = sw * armSwing;
    this.armR.rotation.z = -sw * armSwing;
    this.armL.rotation.x = M.lerp(0.06, -0.22, aim);
    this.armR.rotation.x = M.lerp(-0.06, 0.22, aim);
    this.foreL.rotation.z = M.lerp(-0.25 - Math.max(0, sw) * 0.35, -1.15, aim);
    this.foreR.rotation.z = M.lerp(-0.25 - Math.max(0, -sw) * 0.35, -1.30, aim);
    if (aim > 0.01) {
      this.armR.rotation.z = M.lerp(this.armR.rotation.z, -1.42, aim);
      this.armL.rotation.z = M.lerp(this.armL.rotation.z, -1.28, aim);
      this.armL.rotation.x = M.lerp(this.armL.rotation.x, -0.55, aim);
    }

    // body bob and lean
    var bob = moving ? Math.abs(sw2) * 0.035 * stride : Math.sin(p * 0.8) * 0.006;
    this.pelvis.position.y = this.hipY + bob;
    this.pelvis.rotation.y = moving ? -sw * 0.10 * stride : 0;
    this.torso.rotation.y = moving ? sw * 0.13 * stride : Math.sin(p * 0.7) * 0.02;
    var leanTarget = M.clamp(speed * 0.022, 0, 0.16) + (opts.lean || 0);
    this.lean = M.damp(this.lean, leanTarget, 8, dt);
    this.torso.rotation.z = -this.lean - aim * 0.05;

    // head: look where you aim
    this.neck.rotation.z = M.lerp(Math.sin(p * 0.9) * 0.02, -(opts.pitch || 0) * 0.5, aim);
    this.neck.rotation.y = 0;

    if (opts.recoil) {
      this.armR.rotation.z -= opts.recoil * 0.35;
      this.torso.rotation.z += opts.recoil * 0.12;
    }
  };

  Character.prototype.setPos = function (x, y, z, yaw) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = -yaw;
    this.baseY = y;
    this.shadow.position.y = 0.04;
  };

  Character.prototype.die = function () {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.deathT = 0;
  };

  Character.prototype.dispose = function () {
    this.root.traverse(function (o) {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
  };

  SB.Character = Character;
  SB.CHAR_PALETTES = { SKIN: SKIN, SHIRT: SHIRT, PANTS: PANTS, HAIR: HAIR };

})(window.SB = window.SB || {});
