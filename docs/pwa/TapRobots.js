// TapRobotsのJavaScript
//ライブラリの読み込み
import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';

//// 全体で使用する変数色々
// イベント関係
let winker=0; // 点滅時間
let start_button = false; // startボタン押された
let ok_button = false;    // okボタン押された
// 以下デバイスの向き関係
let alpha = 0; // Z軸回り(ラジアン)
let beta = 0;  // X軸回り(ラジアン)
let gamma = 0; // Y軸回り(ラジアン)
// 音声関係
let audioctx; // 音声出力装置(みたいな物)
let bgm1;     // BGM1
let bgm2;     // BGM2
let currentBGM = null; // 現在のBGM
let se1;   // 効果音(Sound Effect)1
let se2;   // 効果音(Sound Effect)2
// ポイティングデバイス
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
// タッチパネル
let f1 = null; // 1本目の指の情報
let f2 = null; // 2本目の指の情報
let oldDistance; // 前回の指の間隔
// キーボードの状態
let upKey = false;
let downKey = false;
let rightKey = false;
let leftKey = false;
let aKey = false;
let zKey = false;
// 3D関係
let clock = null;
let scene = null;
let camera = null;
let camera_distance = 3.0;
let renderer = null;
let objects = [];
let earth = null;
const enemy_count = 10;
let enemies = [];
// ゲーム要素
let time=0; // 時間
let score=0; // スコア

// minからmaxの間の乱数を生成
function rnd(min,max) {return min+(max-min)*Math.random();}

// デバイスの向き情報を受け取るイベントリスナー
function handleOrientation(e) {
  alpha = 3.14*e.alpha/180;
  beta = 3.14*e.beta/180;
  gamma = 3.14*e.gamma/180;
}

// glTFをロードするためのLoader
const gltfLoader = new GLTFLoader();

// glTFをロードする関数
async function loadGLTF(file) {
  return new Promise((resolve,reject) => {
    gltfLoader.load( file, function (gltf) {
      const self = {};
      console.log('loadGLTF: ',file);
      const model = gltf.scene;
      const animations = gltf.animations;
      const mixer = new THREE.AnimationMixer(model);
      const actions = {};
      let firstAction = '';
      for (let i=0;i<animations.length;i++) {
        const clip = animations[i];
        const action = mixer.clipAction(clip);
        actions[clip.name] = action;
        if (i===0) {
          firstAction = clip.name;
          action.play();
        }
        console.log('    ',clip.name);
      }
      self.model = model;
      self.mixer = mixer;
      self.actions = actions;
      self.currentAction = firstAction;
      self.scale = function(s) {
        self.model.scale.set(s,s,s);
      };
      self.position = function(x,y,z) {
        self.model.position.set(x,y,z);
      };
      self.rotation = function(x,y,z) {
        self.model.rotation.set(x,y,z);
      };
      self.loopOnce = function(a_name) {
        if (self.actions[a_name]) {
          self.actions[a_name].clampWhenFinished = true;
          self.actions[a_name].loop = THREE.LoopOnce;
        }
      };
      self.play = function(a_name) {
        if (self.currentAction)
          self.actions[self.currentAction].stop();
        if (self.actions[a_name]) {
          self.actions[a_name].play();
          self.currentAction = a_name;
        }
      };
      resolve(self);
    }, undefined, function (error) {
      reject(error);
    });
  });
}

// 音声ファイルの読み込み
async function loadSample(url) {
  const response = await fetch(url);
  const arraybuf = await response.arrayBuffer();
  const buf = await audioctx.decodeAudioData(arraybuf);
  return buf;
}

// 実際に効果音を出すための処理
function startSE(sound) {
  const src = new AudioBufferSourceNode(audioctx,{buffer:sound});
  src.connect(audioctx.destination);
  src.start();
}

// 実際にBGMを出すための処理
// (効果音とちがって、無限ループ再生する。
//  それと、前になってたBGMを止めないといけない)
function startBGM(sound) {
  if (currentBGM!==null) currentBGM.stop();
  const src = new AudioBufferSourceNode(audioctx,{buffer:sound});
  src.loop = true;
  src.connect(audioctx.destination);
  src.start();
  currentBGM = src;
}

// BGMを止めるための処理
function stopBGM() {
  if (currentBGM!==null) currentBGM.stop();
  currentBGM = null;
}

// 3Dオブジェクトを管理するための関数群
function add(o3d) {
  if (objects.includes(o3d))
    return;
  objects.push(o3d);
  scene.add(o3d.model);
}
function del(o3d) {
  if (objects.includes(o3d)) {
    const idx = objects.indexOf(o3d);
    objects.splice(idx,1);
    scene.remove(o3d.model);
  }
}
function delAll() {
  const os = [].concat(objects);
  for (let o of os) {
    del(o);
  }
}

// Service Workerにメッセージを送って
// cacheを更新する。
function update_cache() {
  const sw = navigator.serviceWorker.controller;
  sw.postMessage("update_cache");
  //setTimeout(()=>location.reload(),3000);
}

// 音を出すためのAudioContextの初期化と
// デバイスの向きの情報の取得はuser gestureによる
// イベントで処理する必要があるので、この関数に
// 分離して入れておく。
function user_gesture() {
  //音声関係の初期化(1)
  audioctx = new AudioContext();
  const emptySource = audioctx.createBufferSource();
  emptySource.start();
  emptySource.stop();
  // デバイスの向きのイベント関係の初期化
  if (navigator.userAgent.match(/Android/i)) {
//alert('Android');
    window.addEventListener("deviceorientation",handleOrientation);
    //window.addEventListener("deviceorientationabsolute",handleOrientation);
  } else if (navigator.userAgent.match(/(iPhone)|(iPad)|(iPod)/i)) {
//alert('iOS');
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS13以降用のプログラム
      DeviceOrientationEvent.requestPermission()
        .then(response => {
          if (response == 'granted') {
            window.addEventListener('deviceorientation',handleOrientation);
          } else {
            alert("デバイスの向き情報取得が許可されませんでした。");
          }
        });
    } else {
      // iOS12用のプログラム
      window.addEventListener("deviceorientation",handleOrientation);
    }
  } else { // PCなどの場合
//alert('PC?');
    // ダメもとで
    window.addEventListener("deviceorientation",handleOrientation);
  }
}

// 最初1回だけ実行することが必要となる初期化処理
async function game_init() {
  // Startボタン初期化
  const button2 = document.querySelector("#start_button");
  button2.addEventListener('click',(e)=>{start_button=true;});
  // OKボタン初期化
  const button3 = document.querySelector("#ok_button");
  button3.addEventListener('click',(e)=>{ok_button=true;});

  //音声関係の初期化(2)
  bgm1 = await loadSample("./models/bgm_maoudamashii_8bit01.mp3");
  bgm2 = await loadSample("./models/bgm_maoudamashii_8bit02.mp3");
  se1 = await loadSample("./models/se_maoudamashii_onepoint01.wav");
  se2 = await loadSample("./models/se_maoudamashii_onepoint02.wav");

  // 3Dモデルの読み込みのキャッシュを有効にする。
  THREE.Cache.enabled = true;
  // 時計を用意する
  clock = new THREE.Clock();
  // 3Dの仮想空間を作る
  scene = new THREE.Scene();
  // カメラを用意する
  const aspect = window.innerWidth/window.innerHeight;
  camera = new THREE.PerspectiveCamera(75,aspect,0.1,1000);
  camera.position.set(0,camera_distance,0);// カメラの位置調整
  camera.rotation.set(-3.14/2,0,0);// カメラの回転

  // 3Dを描画してくれる部品を作る
  renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth,window.innerHeight);
  document.querySelector("#game_main").appendChild(renderer.domElement);

  // 光源を作る1(太陽)
  const light1 = new THREE.DirectionalLight(0xFFFFFF);
  light1.position.set(10,10,10);
  scene.add(light1);
  // 光源を作る2(環境光)
  const light2 = new THREE.AmbientLight(0x404040);
  scene.add(light2);

  earth = await loadGLTF('./models/earth.glb');
  earth.scale(1.0);
  add(earth);

  // Windowのリサイズ対応
  const onWindowResize = function() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight );
  };
  window.addEventListener('resize',onWindowResize,false);

  // ゲームのメイン画面のdivを取り出す
  const gameDiv = document.querySelector('#game_main');

  // タッチイベントの処理
  gameDiv.addEventListener('touchstart',touchstart);
  gameDiv.addEventListener('touchmove',touchmove);
  gameDiv.addEventListener('touchend',touchend);
  gameDiv.addEventListener('touchcancel',touchcancel);

  // PC対応：矢印キーで回転
  window.addEventListener('keydown',pc_keydown);
  window.addEventListener('keyup',pc_keyup);

  // PC対応：マウスクリック
  gameDiv.addEventListener('mousedown',pc_mousedown,false);

  // ゲームスタート画面へ移行させる処理
  document.querySelector('#game_permission').style.display='none';
  document.querySelector('#game_start').style.display='block';
  startBGM(bgm1);
  requestAnimationFrame(game_start);
}

// タッチオブジェクトの情報を受け取り
// 最大2本分の指の情報を保存する関数
function newFinger(touch) {
  // タッチオブジェクト(touch)の中で，指の情報として必要
  // な物(identifier,x,y)だけ入ったオブジェクト(f)を作る
  let f = {};
  f.identifier = touch.identifier;
  f.x = touch.pageX;
  f.y = touch.pageY;
  // f1が空(null)ならf1にfを入れ
  // f2が空(null)ならf2にfを入れる
  if (f1==null) {
    f1 = f;
  } else if (f2==null) {
    f2 = f;
  }
}

// タッチした指が動いた時に，どの指が動いたのか
// 判定した上でf1かf2の座標の情報を更新する．関数
function updateFinger(touch) {
  if (f1!=null && f1.identifier==touch.identifier) {
    f1.x = touch.pageX;
    f1.y = touch.pageY;
  } else if (f2!=null && f2.identifier==touch.identifier) {
    f2.x = touch.pageX;
    f2.y = touch.pageY;
  }
}

// タッチが終了して指が離れた時は対応する
// f1かf2をnullにする関数
function removeFinger(touch) {
  if (f1!=null && f1.identifier==touch.identifier) {
    f1 = null;
  } else if (f2!=null && f2.identifier==touch.identifier) {
    f2 = null;
  }
}

//タッチした瞬間に呼ばれる関数
function touchstart(e) {
  e.preventDefault();
  for (let i=0;i<e.changedTouches.length;i++) {
    let t = e.changedTouches[i];
    pointer.x = (t.clientX/window.innerWidth)*2 - 1;
    pointer.y = -(t.clientY/window.innerHeight)*2 + 1;
  }
  pointed();
  //---
  for (let i=0;i<e.changedTouches.length;i++) {
    newFinger(e.changedTouches[i]);
  }
  if (f1!=null && f2!=null) {
    let d = (f1.x-f2.x)*(f1.x-f2.x)+(f1.y-f2.y)*(f1.y-f2.y);
    oldDistance = Math.sqrt(d);
  }
}
//タッチした指が動いた時に呼ばれる関数
function touchmove(e) {
  e.preventDefault();
  for (let i=0;i<e.changedTouches.length;i++) {
    updateFinger(e.changedTouches[i]);
  }
  if (f1!=null && f2!=null) {
    let d = (f1.x-f2.x)*(f1.x-f2.x)+(f1.y-f2.y)*(f1.y-f2.y);
    let newDistance = Math.sqrt(d);
    camera_distance *= oldDistance/newDistance;
    if (camera_distance>3) camera_distance=3;
    if (camera_distance<1.5) camera_distance=1.5;
    oldDistance = newDistance;
  }
}
//タッチした指が離された時に呼ばれる関数
function touchend(e) {
  e.preventDefault();
  for (let i=0;i<e.changedTouches.length;i++) {
    removeFinger(e.changedTouches[i]);
  }
}
//タッチがキャンセルされた時に呼ばれる関数
function touchcancel(e) {
  touchend(e); // touchend()と同じ処理をさせる
}




function pc_keydown(e) {
  if (e.keyCode===38) upKey=true;
  else if (e.keyCode===40) downKey=true;
  else if (e.keyCode===39) rightKey=true;
  else if (e.keyCode===37) leftKey=true;
  else if (e.keyCode===65) aKey=true;
  else if (e.keyCode===90) zKey=true;
}
function pc_keyup(e) {
  if (e.keyCode===38) upKey=false;
  else if (e.keyCode===40) downKey=false;
  else if (e.keyCode===39) rightKey=false;
  else if (e.keyCode===37) leftKey=false;
  else if (e.keyCode===65) aKey=false;
  else if (e.keyCode===90) zKey=false;
}
function pc_mousedown(e) {
  e.preventDefault();
  pointer.x = (e.clientX/window.innerWidth)*2 - 1;
  pointer.y = -(e.clientY/window.innerHeight)*2 + 1;
  pointed();
}

function pointed() {
  // ポインティングデバイスの処理
  raycaster.setFromCamera(pointer,camera);
  const intersects = raycaster.intersectObjects(scene.children,true);//なんかtrue重要？
  if (intersects.length>0) {
    //intersects[0].object.material.color.set(0xff0000);
    const o = get_toplevel(intersects[0].object);
    let enemy = null;
    for (let e of enemies) {
      if (o==e.model) {
        enemy = e;
        break;
      }
    }
    if (enemy!=null && enemy.dead===false) {
      startSE(se1);
      score++;
      enemy.play('Death');
      enemy.dead = true;
    } else {
      startSE(se2);
    }
  } else {
    startSE(se2);
  }
}

// ゲームスタート画面を処理するループ
function game_start() {
  if (start_button===true) {
    document.querySelector('#game_start').style.display='none';
    document.querySelector('#game_main').style.display='block';
    start_button=false;
    requestAnimationFrame(game_main_init);
    return;
  }
  requestAnimationFrame(game_start);
  winker += 0.03;
  document.querySelector('#game_start_title').style.opacity=Math.abs(Math.sin(winker));
}

// ゲームメインの処理1(初期化)
async function game_main_init() {
  alpha = beta = gamma = 0; // 回転角リセット
  camera_distance = 3; // カメラの距離リセット

  for (let i=0;i<enemy_count;i++) {
    const e = await loadGLTF('./models/RobotExpressive.glb');
    e.scale(0.08);
    e.loopOnce('Death');
    e.position(0,0,0);
    e.rotation(rnd(-3.14,3.14),rnd(-3.14,3.14),rnd(-3.14,3.14));
    e.model.translateY(1.0);
    e.life = 100;
    e.dead = false;
    if (rnd(0,1)>0.5) {
      e.play('Walking');
      e.velocity = 0.01;
      e.angle = 0.01;
    } else {
      e.play('Running');
      e.velocity = 0.02;
      e.angle = 0.02;
    }
    enemies[i] = e;
    add(e);
  }

  time=30;
  score=0;
  startBGM(bgm2);
  requestAnimationFrame(game_main_loop);
}

// ゲームメインのメインループ
function game_main_loop() {
  if (time<0.5 || score===enemy_count) {
    document.querySelector('#game_main').style.display='none';
    document.querySelector('#game_over').style.display='block';
    requestAnimationFrame(game_main_end);
    return;
  }
  requestAnimationFrame(game_main_loop);

  document.querySelector('#score').textContent="SCORE: "+score;
  document.querySelector('#time').textContent="TIME: "+Math.floor(time);

  // キーボードでの操作対応
  let dBeta=0.0,dGamma=0.0,dScale=1.0;
  if (upKey===true) dBeta+=0.01; // 上矢印キー
  if (downKey===true) dBeta-=0.01; // 下矢印キー
  if (rightKey===true) dGamma-=0.01; // 右矢印キー
  if (leftKey===true) dGamma+=0.01; // 左矢印キー
  if (aKey===true) dScale-=0.01; // A:拡大
  if (zKey===true) dScale+=0.01; // Z:縮小
  let e0 = new THREE.Euler(beta,gamma,alpha,'ZXY');
  let q0 = new THREE.Quaternion();q0.setFromEuler(e0);
  let q1 = new THREE.Quaternion(Math.sin(dBeta),0,0,Math.cos(Math.abs(dBeta)));
  let q2 = new THREE.Quaternion(0,Math.sin(dGamma),0,Math.cos(Math.abs(dGamma)));
  q1.multiply(q2);
  q0.multiply(q1);
  e0.setFromQuaternion(q0)
  alpha = e0.z;
  beta = e0.x;
  gamma = e0.y;
  camera_distance *= dScale;
  if (camera_distance<1.5) camera_distance=1.5;
  else if (camera_distance>3.0) camera_distance=3.0;

  // スマホの上端を北をまっすぐ向くようにして
  // 机に置いた状態にして、それを上から覗き込んでいる
  // のを初期のカメラ位置と考える
  // https://developer.mozilla.org/ja/docs/Web/Events/Orientation_and_motion_data_explained
  // https://triple-underscore.github.io/deviceorientation-ja.html#deviceorientationabsolute
  const rot = new THREE.Euler();
  const rz = alpha;
  const rx = beta;
  const ry = gamma;
  rot.set(rx,ry,rz,'ZXY');//これでいいと思うんだけど
  camera.position.set(0,0,0);
  camera.setRotationFromEuler(rot);
  camera.translateZ(camera_distance);

  // 敵のアニメーション
  const dt = clock.getDelta();
  const need_del = [];
  for (let e of enemies) {
    if (e.dead===false) {
      e.model.translateZ(e.velocity);
      e.model.rotateX(e.angle);
    } else {
      e.life--;
      if (e.life<=0) {
        need_del.push(e);
      }
    }
    e.mixer.update(dt);
  }
  for (let nd of need_del) {
    const idx = enemies.indexOf(nd);
    enemies.splice(idx,1);
    del(nd);
  }

  if (dt<1.0) // GameOver<->GameStart間を除くため
    time = time-dt;

  // 描画
  renderer.render(scene,camera);
}

// 複雑な3Dオブジェクト(a)の中に
// 指定された3Dオブジェクト(b)が入ってるかどうかの判定
// (例えば、キャラクター(a)が、剣(b)を持っていれば
// true持ってなければfalse)
function object3d_contains(a,b) {
  if (a==b) return true;
  if (!b.parent) return false;
  return object3d_contains(a,b.parent);
}

// Object3Dを受け取ってsceneに直接addされた
// トップレベルのObject3Dを返す。(例えば、
// キャラクターの頭のObject3Dから、キャラクター
// 全体のObject3Dを導き出すのに使う)
function get_toplevel(a) {
  if (a.parent===scene)
    return a;
  if (!a.parent)
    return null;
  return get_toplevel(a.parent);
}

// ゲームメインの後処理をする関数
function game_main_end() {
  for (let e of enemies) {
    del(e);
  }
  enemies.splice(0);
  stopBGM();
  document.querySelector('#score2').textContent = `${score}/${enemy_count}`;
  requestAnimationFrame(game_over);
}

// ゲームオーバー画面
function game_over() {
  if (ok_button===true) {
    document.querySelector('#game_over').style.display='none';
    document.querySelector('#game_start').style.display='block';
    ok_button=false;
    startBGM(bgm1);
    requestAnimationFrame(game_start);
    return;
  }
  requestAnimationFrame(game_over);
  winker += 0.03;
  document.querySelector('#game_over_title').style.opacity=Math.abs(Math.sin(winker));
}

// service workerからメッセージを受け取る処理
navigator.serviceWorker.addEventListener('message', (e) => {
  console.log('oc.js received a message: ',e.data);
  switch(e.data) {
  case 'cache updated.':
    setTimeout(()=>location.reload(),3000);
    break;
  default:
    // do nothing.
    break;
  }
});

export {update_cache, user_gesture, game_init};
