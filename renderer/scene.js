// 3D oda: mobilyalar, karakterler, yürüme/poz animasyonları.
// Hiçbir model dosyası yok; her şey basit geometrilerden kurulur (low-poly görünüm).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const C = {
  floor: 0x6b4f3a, floorAlt: 0x5e4433, wall: 0xd9cbb6, wallTrim: 0xb9a68c,
  desk: 0xa47148, deskTop: 0xc08a5a, metal: 0x3a3740, screenOff: 0x111016,
  chair: 0x2d2a35, rug: 0x7a3e3a, plant: 0x4f8a4a, pot: 0xc4673f,
  book: [0xc0523f, 0x3f6fa8, 0xe0b44c, 0x5e9a62, 0x8a5aa8, 0xd8d0c0],
  skin: 0xf0c7a0, hair: 0x2a1c14, hoodie: 0x3b5f8f, pants: 0x2c2f3a, shoe: 0x1c1a20,
  claude: 0xd97757, mascotEye: 0x17120f,
};

const AGENT_COLORS = [0x5aa6d6, 0x7cc47f, 0xb98ad9, 0xe2b94f, 0x5fc7b8, 0xe0789a, 0x9aa3b5];

// Koridor: odadaki tüm yürüyüşler bu z çizgisi üzerinden geçer.
const CORRIDOR_Z = 1.0;
const SEAT_Y = 0.5;

const lerp = (a, b, k) => a + (b - a) * k;
const angLerp = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};
const facing = (dx, dz) => Math.atan2(dx, dz);

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, flatShading: true, ...extra });
}

function box(w, h, d, color, extra) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? mat(color, extra) : color);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, color, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'number' ? mat(color) : color);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function at(obj, x, y, z) { obj.position.set(x, y, z); return obj; }

// ---------------------------------------------------------------------------
// Karakter
// ---------------------------------------------------------------------------

class Character {
  constructor(world, { id, kind, color = C.claude, label = null, scale = 1 }) {
    this.world = world;
    this.id = id;
    this.kind = kind; // 'user' | 'claude' | 'agent'
    this.scale = scale;
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    this.j = {}; // eklemler
    this.cur = {}; // mevcut eklem açıları (yumuşatılmış)
    this.path = [];
    this.speed = kind === 'agent' ? 1.9 : 1.6;
    this.spot = null;
    this.pose = 'stand';
    this.heading = 0;
    this.lookTarget = null;
    this.lookUntil = 0;
    this.arrivedAt = 0;
    this.onArrive = null;
    this.pending = null;
    this.walkPhase = Math.random() * 10;
    this.typingUntil = 0;
    this.gone = false;

    if (kind === 'user') this.buildHuman();
    else this.buildMascot(color);

    this.bubble = document.createElement('div');
    this.bubble.className = 'bubble';
    world.overlay.appendChild(this.bubble);
    this.bubbleUntil = 0;

    if (label) {
      this.tag = document.createElement('div');
      this.tag.className = 'tag';
      this.tag.textContent = label;
      this.tag.style.background = `#${new THREE.Color(color).multiplyScalar(0.7).getHexString()}`;
      world.overlay.appendChild(this.tag);
    }
    world.scene.add(this.root);
  }

  // İnsan (sen): kapüşonlu, kot, saçlı.
  buildHuman() {
    this.buildBody({
      torso: C.hoodie, arm: C.hoodie, hand: C.skin, leg: C.pants, shoe: C.shoe,
      head: () => {
        const g = new THREE.Group();
        g.add(at(new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), mat(C.skin)), 0, 0.17, 0));
        const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), mat(C.hair));
        hair.scale.set(1, 0.62, 1.04);
        g.add(at(hair, 0, 0.27, -0.02));
        g.add(at(box(0.2, 0.06, 0.12, C.hoodie), 0, 0.0, -0.1)); // kapüşon yaka
        g.children.forEach((m) => { m.castShadow = true; });
        return g;
      },
    });
  }

  // Claude Code maskotu: terminal banner'ındaki piksel desenin 3D hali.
  //    ▐▛███▜▌     geniş gövde, iki koyu göz
  //   ▝▜█████▛▘    yanlarda kısa kollar
  //     ▘▘ ▝▝      dört bacak
  // Bir piksel 1 birim genişlik × 2 birim yükseklik (terminal hücresi oranı).
  buildMascot(color) {
    this.rig = 'mascot';
    const P = 0.07, R = 0.14;
    const W = 12 * P, H = 4 * R, D = 0.38;
    const legH = 0.16;
    this.legH = legH;
    const j = this.j;

    j.hips = at(new THREE.Group(), 0, legH, 0);
    this.root.add(j.hips);
    j.torso = new THREE.Group();
    j.hips.add(j.torso);
    j.torso.add(at(box(W, H, D, color), 0, H / 2, 0));

    // Gözler: logodaki iki boşluk, ön yüzde koyu bloklar.
    j.eyes = at(new THREE.Group(), 0, H - 1.5 * R, D / 2);
    j.torso.add(j.eyes);
    this.eyeMeshes = [-3.5 * P, 3.5 * P].map((x) => {
      const e = box(P, R, 0.03, C.mascotEye, { roughness: 0.4 });
      j.eyes.add(at(e, x, 0, 0.004));
      return e;
    });

    // Kollar: gövdenin yanından dışarı uzanan 2 piksellik çıkıntılar.
    for (const side of ['l', 'r']) {
      const sx = side === 'l' ? 1 : -1;
      const arm = at(new THREE.Group(), sx * W / 2, H - 2.5 * R, 0);
      arm.add(at(box(2 * P + 0.02, R, 0.2, color), sx * (P + 0.01), 0, 0));
      const hand = at(new THREE.Group(), sx * (2 * P + 0.04), 0, 0);
      arm.add(hand);
      j.torso.add(arm);
      j[side + 'Arm'] = arm;
      j[side + 'Hand'] = hand;
    }

    // Bacaklar: 4, 6, 11 ve 13. sütunlar.
    j.legs = [-4.5, -2.5, 2.5, 4.5].map((col) => {
      const leg = at(new THREE.Group(), col * P, 0, 0);
      leg.add(at(box(P + 0.01, legH, 0.14, color), 0, -legH / 2, 0));
      j.hips.add(leg);
      return leg;
    });

    j.top = at(new THREE.Object3D(), 0, H + 0.14, 0);
    j.torso.add(j.top);

    this.mug = new THREE.Group();
    this.mug.add(cyl(0.05, 0.045, 0.11, 0xf4efe6, 10));
    this.mug.add(at(box(0.05, 0.05, 0.02), 0, 0, 0.06));
    j.rHand.add(at(this.mug, 0, 0.05, 0));
    this.book = box(0.04, 0.26, 0.2, C.book[1]);
    this.book.rotation.z = 0.35;
    j.rHand.add(at(this.book, 0, 0.1, 0.12));
    this.mug.visible = this.book.visible = false;
    this.blinkAt = 2.5 + Math.random() * 3;
  }

  // Ortak iskelet: kalça → gövde → baş; omuz → üst kol → ön kol; kalça → uyluk → baldır.
  buildBody(p) {
    this.rig = 'biped';
    const j = this.j;
    j.hips = at(new THREE.Group(), 0, 0.74, 0);
    this.root.add(j.hips);

    j.torso = new THREE.Group();
    j.hips.add(j.torso);
    const chest = box(0.42, 0.5, 0.26, p.torso);
    j.torso.add(at(chest, 0, 0.27, 0));
    j.torso.add(at(box(0.38, 0.1, 0.24, p.leg), 0, 0.02, 0));

    j.neck = at(new THREE.Group(), 0, 0.53, 0);
    j.torso.add(j.neck);
    j.head = p.head();
    j.neck.add(j.head);
    j.top = at(new THREE.Object3D(), 0, 0.42, 0);
    j.head.add(j.top);

    for (const side of ['l', 'r']) {
      const sx = side === 'l' ? 1 : -1;
      const sh = at(new THREE.Group(), 0.27 * sx, 0.47, 0);
      j.torso.add(sh);
      sh.add(at(box(0.11, 0.3, 0.11, p.arm), 0, -0.13, 0));
      const el = at(new THREE.Group(), 0, -0.28, 0);
      sh.add(el);
      el.add(at(box(0.1, 0.26, 0.1, p.arm), 0, -0.12, 0));
      el.add(at(box(0.09, 0.08, 0.09, p.hand), 0, -0.27, 0));
      const hand = at(new THREE.Group(), 0, -0.3, 0.02);
      el.add(hand);
      j[side + 'Sh'] = sh;
      j[side + 'El'] = el;
      j[side + 'Hand'] = hand;

      const hip = at(new THREE.Group(), 0.11 * sx, 0, 0);
      j.hips.add(hip);
      hip.add(at(box(0.15, 0.38, 0.15, p.leg), 0, -0.18, 0));
      const knee = at(new THREE.Group(), 0, -0.37, 0);
      hip.add(knee);
      knee.add(at(box(0.13, 0.33, 0.13, p.leg), 0, -0.16, 0));
      knee.add(at(box(0.15, 0.07, 0.24, p.shoe), 0, -0.34, 0.04));
      j[side + 'Hip'] = hip;
      j[side + 'Knee'] = knee;
    }

    // El aksesuarları: kupa ve kitap
    this.mug = new THREE.Group();
    this.mug.add(cyl(0.05, 0.045, 0.11, 0xf4efe6, 10));
    this.mug.add(at(box(0.02, 0.05, 0.05, 0xf4efe6), 0.06, 0, 0));
    this.mug.rotation.x = Math.PI / 2;
    j.rHand.add(at(this.mug, 0, -0.02, 0.05));
    this.book = box(0.2, 0.26, 0.04, C.book[1]);
    this.book.rotation.x = -1.2;
    j.rHand.add(at(this.book, 0.13, 0, 0.06));
    this.mug.visible = this.book.visible = false;
  }

  // --- hareket -------------------------------------------------------------

  placeAt(spotName) {
    const s = this.world.spots[spotName];
    this.root.position.set(s.pos.x, 0, s.pos.z);
    this.heading = this.root.rotation.y = s.face;
    this.spot = spotName;
    this.arrivedAt = this.world.time;
  }

  get walking() { return this.path.length > 0; }

  // Bir noktaya git ve oraya varınca `pose` pozuna geç.
  // Yürürken yeni hedef gelirse yol bölünmez; varınca sıradakine geçilir.
  goTo(spotName, pose, { onArrive = null, dwell = 0 } = {}) {
    const req = { spotName, pose, onArrive };
    const now = this.world.time;
    if (this.walking || now - this.arrivedAt < dwell) {
      this.pending = { ...req, dwell };
      return;
    }
    this.pending = null;
    this.startWalk(req);
  }

  startWalk({ spotName, pose, onArrive }) {
    const to = this.world.spots[spotName];
    if (this.spot === spotName) {
      this.pose = pose;
      this.onArrive = null;
      if (onArrive) onArrive(this);
      return;
    }
    const from = this.spot ? this.world.spots[this.spot] : null;
    const p = this.root.position;
    const pts = [];
    if (from) pts.push(from.appr);
    const last = pts.length ? pts[pts.length - 1] : { x: p.x, z: p.z };
    pts.push({ x: last.x, z: CORRIDOR_Z });
    pts.push({ x: to.appr.x, z: CORRIDOR_Z });
    pts.push(to.appr, to.pos);
    this.path = [];
    let prev = { x: p.x, z: p.z };
    for (const q of pts) {
      if (Math.hypot(q.x - prev.x, q.z - prev.z) > 0.05) this.path.push({ x: q.x, z: q.z });
      prev = q;
    }
    this.spot = null;
    this.destSpot = spotName;
    this.pose = pose;
    this.onArrive = onArrive;
    if (!this.path.length) this.arrive();
  }

  arrive() {
    this.spot = this.destSpot;
    this.arrivedAt = this.world.time;
    const cb = this.onArrive;
    this.onArrive = null;
    if (cb) cb(this);
  }

  // Bir süreliğine başka bir karaktere/noktaya dön.
  look(target, seconds = 2.5) {
    this.lookTarget = target;
    this.lookUntil = this.world.time + seconds;
  }

  say(html, seconds = 3.5, variant = '') {
    this.bubble.innerHTML = html;
    this.bubble.className = `bubble show ${variant}`;
    this.bubbleUntil = this.world.time + seconds;
  }

  remove() {
    this.gone = true;
    this.world.scene.remove(this.root);
    this.bubble.remove();
    if (this.tag) this.tag.remove();
  }

  // --- kare güncellemesi -----------------------------------------------------

  update(dt) {
    const t = this.world.time;
    const p = this.root.position;
    let moving = false;

    if (this.path.length) {
      const q = this.path[0];
      const dx = q.x - p.x, dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (d <= step) {
        p.x = q.x; p.z = q.z;
        this.path.shift();
        if (!this.path.length) this.arrive();
      } else {
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        this.heading = angLerp(this.heading, facing(dx, dz), Math.min(1, dt * 12));
        moving = true;
      }
    } else if (this.pending && t - this.arrivedAt >= this.pending.dwell) {
      const req = this.pending;
      this.pending = null;
      this.startWalk(req);
    }

    if (!moving && this.spot) {
      let target = this.world.spots[this.spot].face;
      if (this.lookTarget && t < this.lookUntil) {
        const lp = this.lookTarget.root ? this.lookTarget.root.position : this.lookTarget;
        target = facing(lp.x - p.x, lp.z - p.z);
        // Otururken sadece belden dön (sandalye dönerken gövde 90°'den fazla dönmesin).
        if (this.isSitting()) {
          const base = this.world.spots[this.spot].face;
          let d = angLerp(0, target - base, 1);
          d = Math.max(-1.2, Math.min(1.2, d));
          target = base + d;
        }
      }
      this.heading = angLerp(this.heading, target, Math.min(1, dt * 6));
    }
    this.root.rotation.y = this.heading;

    this.animate(dt, t, moving);
    this.updateOverlay();
  }

  isSitting() {
    return ['sit', 'type', 'think', 'lean', 'raise', 'listen'].includes(this.pose) && !this.walking && !!this.spot;
  }

  animate(dt, t, moving) {
    if (this.rig === 'mascot') return this.animateMascot(dt, t, moving);
    const pose = moving ? 'walk' : this.pose;
    const sitting = !moving && this.isSitting();
    const typing = pose === 'type' || (this.kind === 'user' && t < this.typingUntil);
    const a = {
      y: 0, lean: 0, headX: 0, headY: 0,
      lShX: 0, lShZ: 0.06, lElX: 0, rShX: 0, rShZ: -0.06, rElX: 0,
      lHipX: 0, lKneeX: 0, rHipX: 0, rKneeX: 0,
    };
    const breathe = Math.sin(t * 2 + this.walkPhase) * 0.015;

    if (pose === 'walk') {
      this.walkPhase += dt * this.speed * 5.2;
      const s = Math.sin(this.walkPhase);
      a.lHipX = s * 0.55; a.rHipX = -s * 0.55;
      a.lKneeX = Math.max(0, -s) * 0.8; a.rKneeX = Math.max(0, s) * 0.8;
      a.lShX = -s * 0.5; a.rShX = s * 0.5;
      a.lElX = -0.3; a.rElX = -0.3;
      a.y = Math.abs(Math.cos(this.walkPhase)) * 0.04;
      a.lean = 0.06;
    }

    if (sitting) {
      a.y = SEAT_Y - 0.74;
      a.lHipX = a.rHipX = -Math.PI / 2;
      a.lKneeX = a.rKneeX = Math.PI / 2;
    }

    if (typing) {
      a.lean = 0.12;
      a.lShX = a.rShX = -0.55;
      a.lElX = a.rElX = -1.05;
      a.lShZ = 0.2; a.rShZ = -0.2;
      const f = this.kind === 'user' ? 22 : 30;
      a.lElX += Math.sin(t * f) * 0.09;
      a.rElX += Math.sin(t * f + 1.7) * 0.09;
      a.headX = 0.12 + Math.sin(t * 3) * 0.02;
    } else if (pose === 'think') {
      a.lean = 0.18;
      a.rShX = -1.0; a.rElX = -1.9; a.rShZ = 0.15;
      a.lShX = -0.4; a.lElX = -0.9;
      a.headX = 0.2 + Math.sin(t * 1.3) * 0.05;
      a.headY = Math.sin(t * 0.7) * 0.15;
    } else if (pose === 'lean') {
      a.lean = -0.22;
      a.headX = -0.15;
      a.rShX = -0.9; a.rElX = -1.4; // kupayı tutuyor
      a.lShX = 0.1; a.lShZ = 0.25;
    } else if (pose === 'listen') {
      a.lean = -0.05;
      a.headX = -0.05 + Math.sin(t * 4) * 0.04; // başını sallıyor
      a.lShX = -0.3; a.rShX = -0.3; a.lElX = a.rElX = -0.6;
    } else if (pose === 'raise') {
      a.rShX = -2.9 + Math.sin(t * 6) * 0.08; a.rShZ = -0.2; a.rElX = -0.2;
      a.lShX = -0.3; a.lElX = -0.8;
      a.headX = -0.1;
    } else if (pose === 'wave') {
      a.rShX = -2.6; a.rShZ = -0.5 + Math.sin(t * 9) * 0.35; a.rElX = -0.3;
      a.headY = 0.1;
    } else if (pose === 'read') {
      a.rShX = -1.1; a.rElX = -0.9; a.lShX = -1.0; a.lElX = -1.0; a.lShZ = 0.4;
      a.headX = 0.35 + Math.sin(t * 0.8) * 0.04;
    } else if (pose === 'tinker') {
      // Sunucu rafını kurcalıyor: kollar önde, sırayla uzanıyor.
      a.lean = 0.12;
      a.lShX = -1.4 + Math.sin(t * 5) * 0.3; a.lElX = -0.5;
      a.rShX = -1.2 + Math.sin(t * 5 + 2) * 0.3; a.rElX = -0.6;
      a.headX = 0.1;
    } else if (pose === 'drink') {
      const sip = (Math.sin(t * 1.4) + 1) / 2;
      a.rShX = -0.9 - sip * 0.6; a.rElX = -1.5 - sip * 0.5; a.rShZ = 0.15;
      a.headX = -sip * 0.25;
    } else if (pose === 'report') {
      a.rShX = -1.3; a.rElX = -0.4; // raporu uzatıyor
      a.headX = 0.05;
    } else if (pose === 'scratch') {
      a.rShX = -2.6; a.rElX = -1.8; a.rShZ = -0.3;
      a.headY = Math.sin(t * 2) * 0.1;
    } else if (!moving) {
      a.headY = Math.sin(t * 0.5 + this.walkPhase) * 0.12;
    }

    // Yumuşak geçiş
    const k = Math.min(1, dt * (moving ? 14 : 8));
    for (const key in a) this.cur[key] = this.cur[key] === undefined ? a[key] : lerp(this.cur[key], a[key], k);
    const c = this.cur, j = this.j;
    j.hips.position.y = 0.74 + c.y;
    j.torso.rotation.x = c.lean;
    j.torso.position.y = breathe;
    j.head.rotation.x = c.headX;
    j.head.rotation.y = c.headY;
    j.lSh.rotation.x = c.lShX; j.lSh.rotation.z = c.lShZ; j.lEl.rotation.x = c.lElX;
    j.rSh.rotation.x = c.rShX; j.rSh.rotation.z = c.rShZ; j.rEl.rotation.x = c.rElX;
    j.lHip.rotation.x = c.lHipX; j.lKnee.rotation.x = c.lKneeX;
    j.rHip.rotation.x = c.rHipX; j.rKnee.rotation.x = c.rKneeX;

    this.mug.visible = !moving && (pose === 'drink' || pose === 'lean');
    this.book.visible = !moving && pose === 'read';
  }

  animateMascot(dt, t, moving) {
    const pose = moving ? 'walk' : this.pose;
    const sitting = !moving && this.isSitting();
    // u: kolu yukarı kaldırma, f: öne çevirme (radyan)
    const a = {
      y: 0, lean: 0, roll: 0, eyeX: 0, eyeY: 0, lid: 1,
      lU: -0.15, lF: 0, rU: -0.15, rF: 0, legA: 0, legB: 0,
    };

    if (pose === 'walk') {
      this.walkPhase += dt * this.speed * 9;
      const s = Math.sin(this.walkPhase);
      a.legA = s * 0.7; a.legB = -s * 0.7;
      a.y = Math.abs(Math.cos(this.walkPhase)) * 0.035;
      a.roll = s * 0.07; // yengeç gibi paytak yürüyüş
      a.lU = 0.1 + s * 0.3; a.rU = 0.1 - s * 0.3;
      a.lean = 0.05;
    }
    if (sitting) {
      a.y = SEAT_Y / this.scale - this.legH;
      a.legA = a.legB = -Math.PI / 2;
    }

    switch (pose) {
      case 'type':
        a.lean = 0.1;
        a.lF = a.rF = 1.25;
        a.lU = -0.35 + Math.sin(t * 28) * 0.22;
        a.rU = -0.35 + Math.sin(t * 28 + 1.7) * 0.22;
        a.eyeY = -1;
        break;
      case 'think':
        a.rF = 1.0; a.rU = 0.55; a.lU = -0.25;
        a.eyeX = Math.sin(t * 0.9); a.eyeY = 0.8;
        a.roll = Math.sin(t * 1.2) * 0.04;
        break;
      case 'lean':
        a.lean = -0.18; a.rF = 1.2; a.rU = 0.25; a.lU = -0.3; a.eyeY = 0.3;
        break;
      case 'listen':
        a.lean = Math.sin(t * 4) * 0.06; a.lU = a.rU = -0.2; a.eyeY = 0.2;
        break;
      case 'raise':
        a.rU = 1.45 + Math.sin(t * 6) * 0.12; a.rF = 0.1; a.eyeY = 0.8;
        a.y += Math.abs(Math.sin(t * 5)) * 0.03;
        break;
      case 'wave':
        a.rU = 1.0 + Math.sin(t * 9) * 0.4; a.eyeY = 0.3;
        a.y += Math.abs(Math.sin(t * 4.5)) * 0.05;
        break;
      case 'read':
        a.lF = a.rF = 1.3; a.lU = a.rU = 0.15; a.lean = 0.06;
        a.eyeY = -0.8; a.eyeX = Math.sin(t * 1.5) * 0.6;
        break;
      case 'tinker':
        a.lean = 0.12; a.lF = a.rF = 1.2;
        a.lU = 0.3 + Math.sin(t * 6) * 0.35; a.rU = 0.3 + Math.sin(t * 6 + 2) * 0.35;
        a.eyeX = Math.sin(t * 2) * 0.7;
        break;
      case 'drink': {
        const sip = (Math.sin(t * 1.4) + 1) / 2;
        a.rF = 1.3; a.rU = 0.1 + sip * 0.6; a.lean = -sip * 0.08;
        if (sip > 0.85) a.lid = 0.25; // keyifle gözlerini kısar
        break;
      }
      case 'report':
        a.rF = 1.45; a.rU = 0.15; a.eyeY = 0.3;
        break;
      case 'scratch':
        a.rU = 1.7 + Math.sin(t * 14) * 0.1; a.rF = 0.3; a.roll = 0.06;
        a.eyeX = Math.sin(t * 3) * 0.6;
        break;
      default:
        if (!moving) a.eyeX = Math.sin(t * 0.5 + this.walkPhase) * 0.6;
    }

    const k = Math.min(1, dt * (moving ? 14 : 8));
    for (const key in a) this.cur[key] = this.cur[key] === undefined ? a[key] : lerp(this.cur[key], a[key], k);
    const c = this.cur, j = this.j;
    j.hips.position.y = this.legH + c.y;
    j.torso.rotation.x = c.lean;
    j.torso.rotation.z = c.roll;
    j.torso.scale.y = 1 + Math.sin(t * 2 + this.walkPhase) * 0.012;
    j.eyes.position.x = c.eyeX * 0.03;
    j.eyes.position.y = 4 * 0.14 - 1.5 * 0.14 + c.eyeY * 0.02;
    j.lArm.rotation.set(0, -c.lF, c.lU);
    j.rArm.rotation.set(0, c.rF, -c.rU);
    j.legs.forEach((leg, i) => { leg.rotation.x = (i === 0 || i === 3) ? c.legA : c.legB; });

    const blink = (t % this.blinkAt) < 0.12;
    this.eyeMeshes.forEach((e) => { e.scale.y = blink ? 0.15 : c.lid; });
    this.mug.visible = !moving && (pose === 'drink' || pose === 'lean');
    this.book.visible = !moving && pose === 'read';
  }

  updateOverlay() {
    const w = this.world;
    const headTop = this.j.top.getWorldPosition(new THREE.Vector3());
    const s = headTop.project(w.camera);
    const visible = s.z < 1 && !this.gone;
    const x = (s.x * 0.5 + 0.5) * w.width;
    const y = (-s.y * 0.5 + 0.5) * w.height;
    if (this.world.time > this.bubbleUntil) this.bubble.classList.remove('show');
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y - 6}px`;
    if (this.tag) {
      const feet = this.root.localToWorld(new THREE.Vector3(0, 0, 0)).project(w.camera);
      this.tag.style.left = `${(feet.x * 0.5 + 0.5) * w.width}px`;
      this.tag.style.top = `${(-feet.y * 0.5 + 0.5) * w.height + 4}px`;
      this.tag.style.opacity = visible ? 1 : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Dünya
// ---------------------------------------------------------------------------

export class World {
  constructor(stage, overlay) {
    this.stage = stage;
    this.overlay = overlay;
    this.time = 0;
    this.characters = new Set();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    stage.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14121a);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.cameraViews = [
      { pos: [7.6, 7.2, 10.2], target: [0.2, 0.4, -0.2] },
      { pos: [2.6, 2.6, 3.6], target: [0, 1.0, -0.8] },
      { pos: [-0.2, 12, 6.5], target: [-0.2, 0, 0.2] },
    ];
    this.camIndex = 0;
    this.fitFactor = 1;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 22;
    this.setView(0);

    this.buildLights();
    this.buildRoom();
    this.buildFurniture();
    this.defineSpots();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(stage);

    this.clock = new THREE.Clock();
    this.listeners = [];
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setView(i) {
    this.camIndex = i % this.cameraViews.length;
    const v = this.cameraViews[this.camIndex];
    this.controls.target.set(...v.target);
    this.camera.position.set(...v.pos).sub(this.controls.target).multiplyScalar(this.fitFactor).add(this.controls.target);
    this.controls.update();
  }

  nextView() { this.setView(this.camIndex + 1); }

  resize() {
    const r = this.stage.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    // Dar sahnede odanın tamamı görünsün diye kamerayı geri çek (kullanıcının açısını koruyarak).
    const f = Math.max(1, 1.25 / this.camera.aspect);
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(f / this.fitFactor);
    this.camera.position.copy(this.controls.target).add(offset);
    this.fitFactor = f;
  }

  onTick(fn) { this.listeners.push(fn); }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    for (const fn of this.listeners) fn(dt, this.time);
    for (const ch of this.characters) ch.update(dt);
    this.updateDoor(dt);
    this.updateScreens(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // --- ışık ve oda -----------------------------------------------------------

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a2c22, 1.1));
    const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
    sun.position.set(5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    const lamp = new THREE.PointLight(0xffb070, 6, 6, 1.6);
    lamp.position.set(-1.3, 1.9, -1.2);
    this.scene.add(lamp);
    this.screenGlow = new THREE.PointLight(0x9fc4ff, 2.5, 3.5, 2);
    this.screenGlow.position.set(0, 1.2, -0.9);
    this.scene.add(this.screenGlow);
  }

  buildRoom() {
    const s = this.scene;
    // Parke zemin: şeritler
    for (let i = 0; i < 14; i++) {
      const plank = box(12.4, 0.1, 0.65, i % 2 ? C.floor : C.floorAlt);
      plank.castShadow = false;
      s.add(at(plank, 0, -0.05, -3.2 + i * 0.65));
    }
    const rug = box(4.2, 0.02, 2.6, C.rug);
    rug.castShadow = false;
    s.add(at(rug, 0.2, 0.01, 0.6));

    // Arka duvar (kapı ve pencere boşluklu) ve sol duvar
    const H = 3.1;
    const back = (x0, x1, y0, y1) => {
      const w = box(x1 - x0, y1 - y0, 0.2, C.wall);
      s.add(at(w, (x0 + x1) / 2, (y0 + y1) / 2, -3.6));
    };
    back(-6.2, -1.9, 0, H);        // pencerenin solu
    back(-1.9, 0.9, 0, 1.0);       // pencere altı
    back(-1.9, 0.9, 2.5, H);       // pencere üstü
    back(0.9, 2.1, 0, H);          // pencere ile kapı arası
    back(2.1, 3.2, 2.3, H);        // kapı üstü
    back(3.2, 6.2, 0, H);          // kapının sağı
    const left = box(0.2, H, 9.2, C.wall);
    s.add(at(left, -6.2, H / 2, 0.9));
    // Süpürgelik
    s.add(at(box(12.4, 0.12, 0.04, C.wallTrim), 0, 0.06, -3.48));
    s.add(at(box(0.04, 0.12, 9.2, C.wallTrim), -6.08, 0.06, 0.9));

    // Pencere: gökyüzü + çerçeve
    const sky = this.makeSkyTexture();
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.5), new THREE.MeshBasicMaterial({ map: sky }));
    s.add(at(glass, -0.5, 1.75, -3.62));
    const frameMat = mat(0xf4ece0);
    s.add(at(box(2.9, 0.08, 0.14, frameMat), -0.5, 1.0, -3.52));
    s.add(at(box(2.9, 0.08, 0.14, frameMat), -0.5, 2.5, -3.52));
    s.add(at(box(0.08, 1.5, 0.14, frameMat), -1.9, 1.75, -3.52));
    s.add(at(box(0.08, 1.5, 0.14, frameMat), 0.9, 1.75, -3.52));
    s.add(at(box(0.05, 1.5, 0.1, frameMat), -0.5, 1.75, -3.52));
    s.add(at(box(3.0, 0.06, 0.3, frameMat), -0.5, 0.98, -3.42)); // denizlik

    // Kapı: menteşe pivotlu panel
    const doorFrame = mat(0x8a5a3a);
    s.add(at(box(0.1, 2.3, 0.26, doorFrame), 2.1, 1.15, -3.6));
    s.add(at(box(0.1, 2.3, 0.26, doorFrame), 3.2, 1.15, -3.6));
    s.add(at(box(1.2, 0.1, 0.26, doorFrame), 2.65, 2.3, -3.6));
    this.doorPivot = at(new THREE.Group(), 2.15, 0, -3.6);
    const panel = box(1.0, 2.2, 0.07, 0xb5804f);
    this.doorPivot.add(at(panel, 0.5, 1.1, 0));
    this.doorPivot.add(at(box(0.06, 0.06, 0.14, 0xd8c08a), 0.88, 1.05, 0));
    s.add(this.doorPivot);
    this.doorAngle = 0;
    // Kapının dışı: koridor zemini (kapı açılınca görünen kısım)
    const hall = box(1.4, 0.1, 1.6, 0x4a3d33);
    hall.castShadow = false;
    s.add(at(hall, 2.65, -0.05, -4.5));

    // Duvar dekorları: tablo, saat
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshStandardMaterial({ map: this.makePosterTexture() }));
    s.add(at(poster, 5.5, 1.95, -3.49));
    const clock = cyl(0.26, 0.26, 0.05, 0xf4ece0, 24);
    clock.rotation.x = Math.PI / 2;
    s.add(at(clock, 1.5, 2.35, -3.47));
    this.clockHand = box(0.02, 0.18, 0.01, 0x2a2420);
    this.clockHand.geometry.translate(0, 0.08, 0);
    s.add(at(this.clockHand, 1.5, 2.35, -3.43));
  }

  buildFurniture() {
    const s = this.scene;

    // Ana masa: sen ve Claude yan yana
    const desk = new THREE.Group();
    desk.add(at(box(3.2, 0.08, 1.0, C.deskTop), 0, 0.78, 0));
    for (const x of [-1.5, 1.5]) desk.add(at(box(0.08, 0.76, 0.9, C.desk), x, 0.38, 0));
    desk.add(at(box(3.0, 0.4, 0.04, C.desk), 0, 0.55, -0.45));
    at(desk, 0, 0, -1.35);
    s.add(desk);

    // Monitörler (ekranlar canvas dokusu)
    this.userScreen = this.makeScreen(512, 320);
    this.claudeScreen = this.makeScreen(512, 320);
    const mon = (x, screen, rotY) => {
      const g = new THREE.Group();
      g.add(at(box(0.05, 0.36, 0.05, C.metal), 0, 1.0, 0));
      g.add(at(box(0.3, 0.02, 0.2, C.metal), 0, 0.83, 0));
      g.add(at(box(1.02, 0.62, 0.05, C.metal), 0, 1.32, -0.02));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.56), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
      g.add(at(face, 0, 1.32, 0.006));
      g.rotation.y = rotY;
      s.add(at(g, x, 0, -1.6));
      // klavye
      s.add(at(box(0.5, 0.03, 0.16, 0x2a2730), x, 0.835, -1.05));
    };
    mon(-0.75, this.userScreen, 0.12);
    mon(0.75, this.claudeScreen, -0.12);

    // Masa lambası, bitki, kupa
    s.add(at(cyl(0.1, 0.12, 0.04, C.metal), -1.35, 0.84, -1.6));
    const arm = box(0.03, 0.55, 0.03, C.metal);
    arm.rotation.z = 0.35;
    s.add(at(arm, -1.25, 1.1, -1.6));
    const shade = cyl(0.06, 0.16, 0.16, 0xe8875f, 12);
    shade.rotation.z = -0.5;
    s.add(at(shade, -1.12, 1.35, -1.5));
    this.addPlant(1.4, 0.82, -1.6, 0.55);

    // Sandalyeler
    this.chairs = {};
    const chair = (x, z, rotY, { back = true } = {}) => {
      const g = new THREE.Group();
      g.add(at(box(0.52, 0.08, 0.5, C.chair), 0, 0.47, 0));
      if (back) g.add(at(box(0.52, 0.6, 0.07, C.chair), 0, 0.82, -0.24));
      g.add(at(cyl(0.04, 0.04, 0.4, C.metal, 6), 0, 0.25, 0));
      g.add(at(box(0.5, 0.04, 0.06, C.metal), 0, 0.05, 0));
      g.add(at(box(0.06, 0.04, 0.5, C.metal), 0, 0.05, 0));
      g.rotation.y = rotY;
      s.add(at(g, x, 0, z));
      return g;
    };
    chair(-0.75, -0.6, Math.PI);
    chair(0.75, -0.6, Math.PI, { back: false }); // Claude'a tabure: arkalık maskotu kapatmasın

    // Ajan masaları: sol duvar boyunca
    this.agentDesks = [];
    const slotsZ = [-2.3, -0.9, 0.5, 1.9, 3.3];
    slotsZ.forEach((z) => {
      const g = new THREE.Group();
      g.add(at(box(0.75, 0.06, 1.05, C.deskTop), 0, 0.72, 0));
      for (const dz of [-0.45, 0.45]) g.add(at(box(0.65, 0.7, 0.05, C.desk), 0, 0.35, dz));
      // dizüstü
      g.add(at(box(0.32, 0.02, 0.24, C.metal), 0.08, 0.76, 0));
      const lid = new THREE.Group();
      const screen = this.makeScreen(128, 80);
      lid.add(at(box(0.32, 0.22, 0.015, C.metal), 0, 0.11, 0));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.19), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }));
      face.rotation.y = Math.PI;
      lid.add(at(face, 0, 0.11, -0.009));
      lid.rotation.x = 0;
      lid.rotation.z = 0;
      const lidHolder = new THREE.Group();
      lidHolder.rotation.y = Math.PI / 2;
      lidHolder.add(lid);
      lid.rotation.x = 0.25;
      g.add(at(lidHolder, -0.04, 0.77, 0));
      s.add(at(g, -5.55, 0, z));
      chair(-4.75, z, -Math.PI / 2);
      this.agentDesks.push({ z, screen, occupant: null });
    });

    // Kitaplık (arka duvar, sol)
    const shelf = new THREE.Group();
    shelf.add(at(box(1.6, 2.3, 0.05, C.desk), 0, 1.15, -0.2));
    for (const x of [-0.78, 0.78]) shelf.add(at(box(0.05, 2.3, 0.42, C.desk), x, 1.15, 0));
    for (let i = 0; i < 5; i++) shelf.add(at(box(1.6, 0.05, 0.42, C.desk), 0, 0.05 + i * 0.55, 0));
    for (let r = 0; r < 4; r++) {
      let x = -0.7;
      while (x < 0.66) {
        const w = 0.06 + Math.random() * 0.06;
        const h = 0.3 + Math.random() * 0.15;
        const b = box(w, h, 0.28, C.book[Math.floor(Math.random() * C.book.length)]);
        b.rotation.z = Math.random() < 0.1 ? 0.2 : 0;
        shelf.add(at(b, x + w / 2, 0.08 + r * 0.55 + h / 2, 0.02));
        x += w + 0.01;
      }
    }
    s.add(at(shelf, -3.6, 0, -3.25));

    // Sunucu rafı (arka duvar, sağ) — yanıp sönen LED'ler
    const rack = new THREE.Group();
    rack.add(at(box(0.8, 2.0, 0.7, 0x24222b), 0, 1.0, 0));
    this.leds = [];
    for (let i = 0; i < 8; i++) {
      rack.add(at(box(0.7, 0.16, 0.02, 0x34313d), 0, 0.35 + i * 0.2, 0.36));
      for (let k = 0; k < 3; k++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: 0x46e07a }));
        rack.add(at(led, 0.22 + k * 0.05, 0.35 + i * 0.2, 0.375));
        this.leds.push(led);
      }
    }
    s.add(at(rack, 4.3, 0, -3.1));

    // Kahve köşesi (sağ ön)
    const counter = new THREE.Group();
    counter.add(at(box(0.7, 0.9, 1.2, 0xe3d6c2), 0, 0.45, 0));
    counter.add(at(box(0.76, 0.05, 1.26, 0x8a6a4a), 0, 0.92, 0));
    const machine = new THREE.Group();
    machine.add(at(box(0.36, 0.42, 0.34, 0x2b2a30), 0, 0.21, 0));
    machine.add(at(box(0.3, 0.06, 0.04, 0x9a9aa6), 0, 0.33, -0.19));
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), new THREE.MeshBasicMaterial({ color: 0xff7b4a }));
    machine.add(at(light, 0.1, 0.38, -0.175));
    machine.rotation.y = Math.PI / 2;
    counter.add(at(machine, 0, 0.95, -0.2));
    counter.add(at(cyl(0.05, 0.045, 0.1, 0xf4efe6), 0.05, 1.0, 0.3));
    s.add(at(counter, 5.6, 0, 1.0));

    // Saksılar ve kanepe havası için puf
    this.addPlant(-5.5, 0, -3.1, 1.2);
    this.addPlant(5.6, 0, -1.6, 1.0);
    const pouf = cyl(0.35, 0.38, 0.38, 0x5a6fa0, 14);
    s.add(at(pouf, 2.6, 0.19, 2.6));
  }

  addPlant(x, y, z, size) {
    const g = new THREE.Group();
    g.add(at(cyl(0.16 * size, 0.12 * size, 0.28 * size, C.pot), 0, 0.14 * size, 0));
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.08 * size, 0.5 * size, 5), mat(C.plant));
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.08 * size, 0.45 * size, Math.sin(a) * 0.08 * size);
      leaf.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      leaf.castShadow = true;
      g.add(leaf);
    }
    this.scene.add(at(g, x, y, z));
  }

  // --- dokular ----------------------------------------------------------------

  makeScreen(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f0e14';
    ctx.fillRect(0, 0, w, h);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, ctx, texture, w, h, lines: [], scroll: 0 };
  }

  makeSkyTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#f4a86a');
    grad.addColorStop(0.6, '#f7c98f');
    grad.addColorStop(1, '#f9dfb0');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#fff3d6';
    g.beginPath(); g.arc(70, 78, 16, 0, Math.PI * 2); g.fill();
    // Şehir silueti
    g.fillStyle = '#b06a54';
    let x = 0;
    while (x < 256) {
      const w = 12 + Math.random() * 22, h = 18 + Math.random() * 45;
      g.fillRect(x, 128 - h, w, h);
      x += w + 2;
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  makePosterTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 176;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2a3a'; g.fillRect(0, 0, 256, 176);
    g.fillStyle = '#e8875f'; g.beginPath(); g.arc(128, 80, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2c35b'; g.fillRect(0, 120, 256, 56);
    g.fillStyle = '#2b2a3a'; g.font = 'bold 22px -apple-system, sans-serif'; g.textAlign = 'center';
    g.fillText('SHIP IT', 128, 157);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Senin ekranın: terminalin son satırları.
  setUserScreenLines(lines) {
    const s = this.userScreen;
    const { ctx, w, h } = s;
    ctx.fillStyle = '#121019';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2633';
    ctx.fillRect(0, 0, w, 22);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(14 + i * 16, 11, 5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.font = '15px Menlo, monospace';
    ctx.fillStyle = '#e8e2d6';
    const lh = 18;
    const max = Math.floor((h - 30) / lh);
    lines.slice(-max).forEach((ln, i) => ctx.fillText(ln.slice(0, 54), 10, 42 + i * lh));
    s.texture.needsUpdate = true;
  }

  updateScreens(dt) {
    // Claude'un ekranı: yazarken akan renkli kod satırları
    const claude = this.claude;
    const s = this.claudeScreen;
    const busy = claude && !claude.walking && claude.spot === 'claudeSeat' && claude.pose === 'type';
    s.acc = (s.acc || 0) + dt;
    if (s.acc > (busy ? 0.08 : 0.6)) {
      s.acc = 0;
      if (busy || !s.lines.length) {
        const indent = Math.floor(Math.random() * 4);
        const tokens = [];
        let n = 1 + Math.floor(Math.random() * 4);
        while (n--) tokens.push({ w: 14 + Math.random() * 70, c: ['#e8875f', '#7fd18b', '#8fb8ff', '#d7a8ff', '#e8e2d6', '#f2c35b'][Math.floor(Math.random() * 6)] });
        s.lines.push({ indent, tokens });
        if (s.lines.length > 15) s.lines.shift();
      }
      const { ctx, w, h } = s;
      ctx.fillStyle = '#16131c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#211d29';
      ctx.fillRect(0, 0, 34, h);
      s.lines.forEach((ln, i) => {
        let x = 46 + ln.indent * 22;
        const y = 12 + i * 20;
        ctx.fillStyle = '#4b4558';
        ctx.fillRect(8, y + 4, 16, 6);
        ln.tokens.forEach((tk) => { ctx.fillStyle = tk.c; ctx.fillRect(x, y + 2, tk.w, 10); x += tk.w + 8; });
      });
      if (busy && Math.floor(this.time * 3) % 2) {
        const last = s.lines.length - 1;
        ctx.fillStyle = '#e8e2d6';
        ctx.fillRect(46 + 300, 12 + last * 20, 8, 14);
      }
      s.texture.needsUpdate = true;
    }

    // Ajan dizüstüleri
    for (const d of this.agentDesks) {
      const sc = d.screen;
      sc.acc = (sc.acc || 0) + dt;
      if (sc.acc < 0.15) continue;
      sc.acc = 0;
      const on = d.occupant && !d.occupant.walking && d.occupant.spot;
      const { ctx, w, h } = sc;
      ctx.fillStyle = on ? '#18151f' : '#0b0a0e';
      ctx.fillRect(0, 0, w, h);
      if (on) {
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = ['#7fd18b', '#8fb8ff', '#e8875f'][(i + Math.floor(this.time * 4)) % 3];
          ctx.fillRect(8, 8 + i * 12, 20 + ((i * 37 + Math.floor(this.time * 7)) % 80), 6);
        }
      }
      sc.texture.needsUpdate = true;
    }

    // Raf LED'leri ve saat
    const hot = claude && claude.spot === 'rack' && claude.pose === 'tinker';
    this.leds.forEach((led, i) => {
      const on = Math.sin(this.time * (hot ? 18 : 3) + i * 1.7) > (hot ? -0.2 : 0.4);
      led.material.color.setHex(on ? (i % 5 === 0 ? 0xffb347 : 0x46e07a) : 0x1d3a26);
    });
    this.clockHand.rotation.z = -this.time * 0.2;
    this.screenGlow.intensity = busy ? 3.2 : 2.0;
  }

  // --- yerler ------------------------------------------------------------------

  // Her yer: durulacak nokta, koridora bağlanan yaklaşma noktası ve bakış yönü.
  defineSpots() {
    const sp = {};
    const add = (name, x, z, ax, az, face) => { sp[name] = { pos: { x, z }, appr: { x: ax, z: az }, face }; };
    add('outside', 2.65, -4.6, 2.65, -2.9, Math.PI);
    add('door', 2.65, -2.9, 2.65, -2.9, 0);
    add('userSeat', -0.75, -0.6, -0.75, 0.1, Math.PI);
    add('claudeSeat', 0.75, -0.6, 0.75, 0.1, Math.PI);
    add('claudeSide', 1.45, -0.35, 1.45, 0.3, -Math.PI / 2 - 0.4); // sana dönüp konuşma noktası
    add('shelf', -3.6, -2.55, -3.6, -2.55, Math.PI);
    add('rack', 4.3, -2.4, 4.3, -2.4, Math.PI);
    add('coffee', 4.95, 1.0, 4.95, 1.0, Math.PI / 2);
    this.agentDesks.forEach((d, i) => {
      add(`agent${i}`, -4.75, d.z, -3.9, d.z, -Math.PI / 2);
      add(`agentReport${i}`, -0.5 + i * 0.3, 0.45, -0.5 + i * 0.3, 0.45, Math.PI); // Claude'a rapor verme noktası
    });
    this.spots = sp;
  }

  updateDoor(dt) {
    let near = false;
    const door = this.spots.door.pos;
    for (const ch of this.characters) {
      const p = ch.root.position;
      if (Math.hypot(p.x - door.x, p.z - (door.z - 0.7)) < 1.6) near = true;
    }
    this.doorAngle = lerp(this.doorAngle, near ? -1.5 : 0, Math.min(1, dt * 5));
    this.doorPivot.rotation.y = this.doorAngle;
  }

  // --- karakter fabrikası ---------------------------------------------------

  addCharacter(opts) {
    const ch = new Character(this, opts);
    this.characters.add(ch);
    return ch;
  }

  removeCharacter(ch) {
    ch.remove();
    this.characters.delete(ch);
  }

  agentColor(type = '') {
    let h = 0;
    for (const c of type) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return AGENT_COLORS[h % AGENT_COLORS.length];
  }
}

export { C as COLORS };
