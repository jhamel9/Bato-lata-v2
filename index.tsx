import { Can, CAN_TARGET_X, CAN_TARGET_Z } from './can.js';

declare const THREE: any;
declare const CANNON: any;

// --- Global Variables ---
let camera, scene, renderer, controls;
let clock;
let can: Can;

// Player State
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();

// Physics/Game State
let world; 
let slipperMesh;
let slipperBody;
let isSlipperHeld = true;
let isMouseDown = false; 
let hitCount = 0; // Track score
let isCanKnockedOverWaitingForReset = false;
let isGameOver = false;
let timerValue = 15.0;
let timerInterval: number;


// Trajectory/Aiming
let guideLine;
let impactMarkerMesh; 

// Constants
const PLAYER_HEIGHT = 30;
const FRICTION_MULTIPLIER = 30.0;
const moveSpeed = 1560.0; 
const jumpVelocity = 50.0; 
const BASE_GRAVITY = -9.8 * 10; 
const FALL_GRAVITY_MULTIPLIER = 2.0; 
const THROW_STRENGTH = 302; 
const SLIPPER_HALF_HEIGHT = 1.5; // Physics half-height (Box is 3 units tall)
const SLIPPER_MASS = 1;
const HORIZONTAL_SPIN_STRENGTH = 12; 
const TIMER_DURATION = 15.0;

// --- Custom Voxel Slipper Constants (Scaled to match physics body) ---
const VOXEL_SIZE = 0.6; // Multiplied from 0.1 to 0.6 to match physics size (8x3x15)

// --- FIELD DIMENSIONS: 350 (X) x 450 (Z) ---
const FIELD_SIZE_X = 350; 
const FIELD_SIZE_Z = 450; 
const WALL_HEIGHT = 50; 
const WALL_THICKNESS = 5; 

const HALF_SIZE_Z = FIELD_SIZE_Z / 2; 
const FOUL_LINE_Z = -100; 

// Pickup radius
const PICKUP_RADIUS = 60;

// UI elements
const statusZone = document.getElementById('status-zone') as HTMLElement; 
let scoreDisplay: HTMLElement;
let timerDisplay: HTMLElement;
let gameOverScreen: HTMLElement;
let finalScoreDisplay: HTMLElement;
let playAgainButton: HTMLElement;

// --- Timer and Game Over Functions ---

function startTimer() {
    if (timerInterval) clearInterval(timerInterval); // Clear any existing timer
    timerValue = TIMER_DURATION;
    timerDisplay.textContent = `Time: ${timerValue.toFixed(1)}`;
    timerDisplay.classList.remove('timer-warning');

    timerInterval = window.setInterval(() => {
        timerValue -= 0.1;
        timerDisplay.textContent = `Time: ${Math.max(0, timerValue).toFixed(1)}`;

        if (timerValue < 5.0 && !timerDisplay.classList.contains('timer-warning')) {
            timerDisplay.classList.add('timer-warning');
        }

        if (timerValue <= 0) {
            triggerGameOver();
        }
    }, 100);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function resetTimer() {
    timerValue = TIMER_DURATION;
    timerDisplay.textContent = `Time: ${timerValue.toFixed(1)}`;
    timerDisplay.classList.remove('timer-warning');
}

function triggerGameOver() {
    if (isGameOver) return; // Prevent multiple triggers
    isGameOver = true;
    stopTimer();
    controls.unlock();

    finalScoreDisplay.textContent = `Final Score: ${hitCount}`;
    gameOverScreen.style.display = 'flex';
}

function restartGame() {
    isGameOver = false;
    gameOverScreen.style.display = 'none';

    // Reset game state
    hitCount = 0;
    scoreDisplay.textContent = `Score: ${hitCount}`;
    
    resetTimer();
    resetGameComponents(true); // fullReset = true

    // Re-engage controls
    controls.lock();
}

// --- Utility Functions for Voxel Slipper ---

/**
 * Utility function to create a single voxel cube.
 */
function addVoxel(x, y, z, material, group) {
    const geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
    const voxel = new THREE.Mesh(geometry, material);
    
    // Calculate world position based on grid coordinate and voxel size
    voxel.position.set(
        x * VOXEL_SIZE, 
        y * VOXEL_SIZE, 
        z * VOXEL_SIZE
    );
    voxel.castShadow = true;
    group.add(voxel);
}

/**
 * Creates the stylized 3D flip-flop model using voxels (based on user's code, scaled).
 * @returns {THREE.Group} A group containing all voxel meshes.
 */
function createSlipper() {
    const slipperGroup = new THREE.Group();
    
    // Materials
    const soleColor = 0xfc6a03; // Bright Orange
    const soleMaterial = new THREE.MeshPhongMaterial({ 
        color: soleColor, 
        shininess: 10 
    });

    const strapColor = 0x333333; // Dark Grey
    const strapMaterial = new THREE.MeshPhongMaterial({ 
        color: strapColor, 
        shininess: 10
    });

    // --- 1. Sole Construction (Z is length, X is width, Y is height/thickness) ---
    const soleY = 0.5; // Y position for the sole (halfway up the voxel size)
    
    // Sole dimensions (in voxels): 9 wide, 25 long
    for (let z = -12; z <= 12; z++) {
        // Taper the width at the front and back
        let width = 9;
        if (z > 8) { // Taper back heel
            width = 7;
        } else if (z < -8) { // Taper front toe
            width = 5 - Math.floor((-8 - z) / 2); 
            if (width < 3) width = 3;
        }

        for (let x = -Math.floor(width / 2); x <= Math.floor(width / 2); x++) {
            addVoxel(x, soleY, z, soleMaterial, slipperGroup);
        }
    }

    // --- 2. Strap Construction (Y-shape) ---
    const strapY = 1.5; // Y position for the strap (one voxel above the sole)
    const toePostZ = -9;
    const sideAttachX = 4;
    
    // A. Toe Post (anchor point)
    addVoxel(0, soleY + 1, toePostZ, strapMaterial, slipperGroup); 

    // B. Left Strap Segment (from toe post Z=-9 to side attach Z=3, total length 12 voxels)
    for (let i = 0; i <= 12; i++) {
        const z = toePostZ + i;
        const x = Math.round((sideAttachX / 12) * i);
        
        addVoxel(x, strapY, z, strapMaterial, slipperGroup);
    }

    // C. Right Strap Segment
    for (let i = 0; i <= 12; i++) {
        const z = toePostZ + i;
        const x = -Math.round((sideAttachX / 12) * i);
        
        addVoxel(x, strapY, z, strapMaterial, slipperGroup);
    }

    // Rotate the group to lie flat on the ground when dropped
    slipperGroup.rotation.x = -Math.PI / 2;
    
    return slipperGroup;
}


// --- Utility Functions ---

/**
 * Calculates trajectory points for parabolic motion (predicts the arc).
 */
function calculateTrajectory(origin, vector, g, T, N) {
    const points = [];
    const step = T / N;
    const acceleration = new THREE.Vector3(0, g, 0); 
    
    for (let i = 0; i <= N; i++) {
        const t = i * step;
        const p = origin.clone();
        p.addScaledVector(vector, t);
        p.addScaledVector(acceleration, 0.5 * t * t);
        
        if (p.y < -10) break; 
        
        points.push(p);
    }
    return points;
}

/**
 * Finds the ground impact point from the calculated trajectory.
 */
function findImpactPoint(points, groundLevel) {
    for (let i = 1; i < points.length; i++) {
        const prevPoint = points[i - 1];
        const currentPoint = points[i];
        
        if (prevPoint.y >= groundLevel && currentPoint.y <= groundLevel) {
            const t = (groundLevel - prevPoint.y) / (currentPoint.y - prevPoint.y);
            return new THREE.Vector3(
                prevPoint.x + t * (currentPoint.x - prevPoint.x),
                groundLevel,
                prevPoint.z + t * (currentPoint.z - prevPoint.z)
            );
        }
    }
    return null; 
}

/**
 * Draws the guide arch and impact marker.
 */
function drawGuideArch() {
    if (!isSlipperHeld) return;
    
    // 1. Get the actual launch origin (where the slipper mesh is currently held)
    const origin = new THREE.Vector3();
    slipperMesh.getWorldPosition(origin); 
    
    // 2. Calculate the initial velocity vector (speed = THROW_STRENGTH / SLIPPER_MASS)
    const throwVector = new THREE.Vector3(0, 0, -1);
    throwVector.applyQuaternion(camera.quaternion); 
    throwVector.multiplyScalar(THROW_STRENGTH / SLIPPER_MASS); 

    // 3. Calculate trajectory points
    const points = calculateTrajectory(origin, throwVector, BASE_GRAVITY, 3.0, 100); 
    
    if (points.length > 1) {
        guideLine.geometry.setFromPoints(points);
        guideLine.visible = true;
    } else {
        guideLine.visible = false;
        impactMarkerMesh.visible = false;
        return;
    }
    
    // We use SLIPPER_HALF_HEIGHT (1.5) as the ground impact level
    const impactPoint = findImpactPoint(points, SLIPPER_HALF_HEIGHT);

    if (impactPoint) {
        impactMarkerMesh.position.copy(impactPoint);
        impactMarkerMesh.position.y = SLIPPER_HALF_HEIGHT + 0.1; 
        impactMarkerMesh.visible = true;
        
        const distance = origin.distanceTo(impactPoint);
        const maxDistance = 500;
        const colorValue = Math.min(distance / maxDistance, 1);
        
        const color = new THREE.Color();
        color.setRGB(colorValue, 1 - colorValue, 0);
        guideLine.material.color.copy(color);
    } else {
        guideLine.material.color.set(0x0088ff);
        impactMarkerMesh.visible = false;
    }
}

/**
 * Resets the physical position of the can and resets the slipper to the player's hand.
 */
function resetGameComponents(fullReset = false) {
    stopTimer(); // Ensure timer is stopped on any reset
    resetTimer(); // Reset the timer display to its initial state
    
    // --- 1. Can Reset ---
    if (can) {
        can.reset();
    }
    
    // --- 2. Slipper Pickup Logic ---
    slipperBody.mass = 0;
    slipperBody.type = CANNON.Body.STATIC;
    slipperBody.updateMassProperties();
    if (world.bodies.includes(slipperBody)) {
         world.removeBody(slipperBody);
    }

    camera.add(slipperMesh);
    slipperMesh.position.set(10, -10, -20); // Position relative to camera (in hand)
    slipperMesh.rotation.set(Math.PI * 0.1, -Math.PI * 0.1, 0); // Slight rotation for a holding grip
    isSlipperHeld = true;
    isMouseDown = false;
    
    // --- 3. UI/State Reset ---
    guideLine.visible = false;
    impactMarkerMesh.visible = false;
    isCanKnockedOverWaitingForReset = false;
    
    if (fullReset) {
         hitCount = 0;
    }
}

/**
 * Creates physical and visual walls around the game field.
 */
function createWalls() {
    const wallMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513, shininess: 30 });
    const halfSizeX = FIELD_SIZE_X / 2;
    const halfSizeZ = FIELD_SIZE_Z / 2;
    const halfHeight = WALL_HEIGHT / 2;
    const halfThickness = WALL_THICKNESS / 2;
    
    const createWall = (sizeX, sizeY, sizeZ, posX, posY, posZ) => {
        const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
        const mesh = new THREE.Mesh(geometry, wallMaterial);
        mesh.position.set(posX, posY, posZ);
        scene.add(mesh);

        const shape = new CANNON.Box(new CANNON.Vec3(sizeX / 2, sizeY / 2, sizeZ / 2));
        const body = new CANNON.Body({ mass: 0, shape: shape });
        body.position.set(posX, posY, posZ);
        world.addBody(body);
    };

    // North/South Walls 
    createWall(FIELD_SIZE_X + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS, 0, halfHeight, -halfSizeZ - halfThickness);
    createWall(FIELD_SIZE_X + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS, 0, halfHeight, halfSizeZ + halfThickness);
    
    // East/West Walls 
    createWall(WALL_THICKNESS, WALL_HEIGHT, FIELD_SIZE_Z, halfSizeX + halfThickness, halfHeight, 0);
    createWall(WALL_THICKNESS, WALL_HEIGHT, FIELD_SIZE_Z, -halfSizeX - halfThickness, halfHeight, 0);
}

/**
 * Creates a row of stylized trees for background scenery behind the field walls.
 */
function createTrees() {
    const numTrees = 15; 
    const treeSpacing = FIELD_SIZE_X / (numTrees - 1);
    const treeZ = HALF_SIZE_Z + WALL_THICKNESS * 2 + 50; 

    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x228b22 });

    for (let i = 0; i < numTrees; i++) {
        const treeX = -FIELD_SIZE_X / 2 + i * treeSpacing;
        
        const trunkHeight = 30 + Math.random() * 20;
        const leafHeight = trunkHeight * 1.5;
        const leafRadius = leafHeight * 0.4;
        const zOffset = Math.random() * 20 - 10; 

        // 1. Trunk (Cylinder)
        const trunkGeometry = new THREE.CylinderGeometry(5, 5, trunkHeight, 8);
        const trunkMesh = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunkMesh.position.set(treeX, trunkHeight / 2, treeZ + zOffset); 
        scene.add(trunkMesh);

        // 2. Leaves (Cone)
        const leafGeometry = new THREE.ConeGeometry(leafRadius, leafHeight, 16);
        const leafMesh = new THREE.Mesh(leafGeometry, leafMaterial);
        leafMesh.position.set(treeX, trunkHeight + (leafHeight / 2) * 0.8, treeZ + zOffset);
        scene.add(leafMesh);
    }
}


// --- Initialization Function ---
function init() {
    // --- Scene/Camera Setup ---
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.set(0, PLAYER_HEIGHT, -180); 

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x99ccff); 
    scene.fog = new THREE.Fog(0x99ccff, 0, 750); 
    
    // UI Elements
    scoreDisplay = document.getElementById('score-display') as HTMLElement;
    timerDisplay = document.getElementById('timer-display') as HTMLElement;
    gameOverScreen = document.getElementById('game-over-screen') as HTMLElement;
    finalScoreDisplay = document.getElementById('final-score') as HTMLElement;
    playAgainButton = document.getElementById('play-again-button') as HTMLElement;

    // Lighting 
    const ambientLight = new THREE.AmbientLight(0xaaaaaa, 0.7);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(100, 200, 100);
    scene.add(directionalLight);

    // Controls
    controls = new THREE.PointerLockControls(camera, document.body);
    controls.getObject().rotation.y = Math.PI; 
    
    const instructions = document.getElementById('instructions');
    
    instructions.addEventListener('click', () => {
        controls.lock(); 
    });

    playAgainButton.addEventListener('click', restartGame);

    controls.addEventListener('lock', () => {
        (instructions as HTMLElement).style.opacity = '0';
        (instructions as HTMLElement).style.pointerEvents = 'none';
    });

    controls.addEventListener('unlock', () => {
        if (!isGameOver) {
            (instructions as HTMLElement).style.opacity = '1';
            (instructions as HTMLElement).style.pointerEvents = 'auto';
        }
    });
    scene.add(controls.getObject());

    // --- CANNON.js Setup ---
    world = new CANNON.World();
    world.gravity.set(0, BASE_GRAVITY, 0); 
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;
    
    // 1. Create Ground Plane (Static Body)
    const groundShape = new CANNON.Plane();
    const groundMaterial = new CANNON.Material('groundMaterial');
    const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial }); 
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2); 
    world.addBody(groundBody);
    
    createWalls(); 
    createTrees(); 

    // --- Game Object Initialization ---
    // 2. Can (Lata) - Now handled by the Can class
    can = new Can(scene, world);

    // Add contact material after both bodies and their materials exist
    const canGroundContactMaterial = new CANNON.ContactMaterial(
        groundMaterial,
        can.body.material, // can.body has a material set in its class
        {
            friction: 0.8,
            restitution: 0.1,
            contactEquationStiffness: 1e8
        }
    );
    world.addContactMaterial(canGroundContactMaterial);

    // 3. Slipper (Bato) Mesh and Body
    slipperMesh = createSlipper(); 

    // Physics shape remains a simple box for stability
    const slipperShape = new CANNON.Box(new CANNON.Vec3(4, SLIPPER_HALF_HEIGHT, 7.5));
    slipperBody = new CANNON.Body({ mass: SLIPPER_MASS, shape: slipperShape, allowSleep: true });
    
    // --- Game Visuals ---
    // Can Marker
    const canMarkerGeometry = new THREE.RingGeometry(15, 20, 32);
    const canMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xcc3333, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    const canMarkerMesh = new THREE.Mesh(canMarkerGeometry, canMarkerMaterial);
    canMarkerMesh.rotation.x = -Math.PI / 2;
    canMarkerMesh.position.set(CAN_TARGET_X, 0.1, CAN_TARGET_Z);
    scene.add(canMarkerMesh);

    // Foul Line Mesh
    const foulLineGeometry = new THREE.PlaneGeometry(FIELD_SIZE_X, 5); 
    const foulLineMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const foulLineMesh = new THREE.Mesh(foulLineGeometry, foulLineMaterial);
    foulLineMesh.rotation.x = -Math.PI / 2;
    foulLineMesh.position.set(0, 0.1, FOUL_LINE_Z); 
    scene.add(foulLineMesh);


    // --- Guide Arch & Impact Marker ---
    const guideMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3, transparent: true, opacity: 0.8 });
    const placeholderPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)]; 
    const guideGeometry = new THREE.BufferGeometry().setFromPoints(placeholderPoints);
    guideLine = new THREE.Line(guideGeometry, guideMaterial);
    scene.add(guideLine);
    guideLine.visible = false; 

    const impactGeometry = new THREE.RingGeometry(6, 10, 16); 
    const impactMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    impactMarkerMesh = new THREE.Mesh(impactGeometry, impactMaterial);
    impactMarkerMesh.rotation.x = Math.PI / 2; 
    scene.add(impactMarkerMesh);
    impactMarkerMesh.visible = false;

    // --- Input Handlers ---
    const onKeyDown = function (event) {
        switch (event.code) {
            case 'KeyW': moveForward = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyS': moveBackward = true; break;
            case 'KeyD': moveRight = true; break;
            case 'Space':
                if (canJump === true) velocity.y += jumpVelocity;
                canJump = false;
                break;
        }
    };

    const onKeyUp = function (event) {
        switch (event.code) {
            case 'KeyW': moveForward = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyS': moveBackward = false; break;
            case 'KeyD': moveRight = false; break;
        }
    };
    
    const onMouseDownHandler = function(e) {
        if (controls.isLocked && e.button === 0) { 
            if (isSlipperHeld) {
                isMouseDown = true;
            } else {
                // Attempt to pick up the slipper (Bato)
                const playerPos = controls.getObject().position.clone();
                const slipperPos = new THREE.Vector3();
                slipperMesh.getWorldPosition(slipperPos); // Get world position of the Group
                const distance = playerPos.distanceTo(slipperPos);
                
                if (distance <= PICKUP_RADIUS) {
                    
                    // Pickup logic
                    slipperBody.mass = 0;
                    slipperBody.type = CANNON.Body.STATIC; // Make it non-physical
                    slipperBody.updateMassProperties(); // Inform the physics engine
                    if (world.bodies.includes(slipperBody)) {
                        world.removeBody(slipperBody);
                    }
                    camera.add(slipperMesh);
                    slipperMesh.position.set(10, -10, -20);
                    slipperMesh.rotation.set(Math.PI * 0.1, -Math.PI * 0.1, 0); // Rotation when held
                    isSlipperHeld = true;
                }
            }
        }
    };

    const onMouseUpHandler = function(e) {
        if (controls.isLocked && isSlipperHeld && isMouseDown && e.button === 0) { 
            
            // Foul Line Check: Player must be behind the line (Z < -100)
            if (controls.getObject().position.z > FOUL_LINE_Z) {
                isMouseDown = false;
                return;
            }

            // THROW ACTION
            isSlipperHeld = false;
            
            const worldPosition = new THREE.Vector3();
            slipperMesh.getWorldPosition(worldPosition);
            const worldQuaternion = new THREE.Quaternion();
            slipperMesh.getWorldQuaternion(worldQuaternion);

            slipperBody.mass = SLIPPER_MASS; 
            slipperBody.type = CANNON.Body.DYNAMIC;
            slipperBody.updateMassProperties();
            world.addBody(slipperBody); 
            
            // Set position and quaternion using component-wise .set()
            slipperBody.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
            slipperBody.quaternion.set(worldQuaternion.x, worldQuaternion.y, worldQuaternion.z, worldQuaternion.w);
            
            // 1. Calculate the base direction vector (aligned with crosshair)
            const throwDirection = new THREE.Vector3(0, 0, -1);
            throwDirection.applyQuaternion(camera.quaternion); 
            
            // 2. Calculate the speed (Velocity Magnitude)
            const launchSpeed = THROW_STRENGTH / SLIPPER_MASS; 

            // 3. Create the initial velocity vector (Direction * Speed)
            const initialVelocity = throwDirection.multiplyScalar(launchSpeed);

            // 4. Set the body's velocity directly to match the prediction arc
            slipperBody.velocity.set(
                initialVelocity.x,
                initialVelocity.y,
                initialVelocity.z
            );
            
            // 5. Apply slight horizontal spin and small tumble
            slipperBody.angularVelocity.set(
                (Math.random() - 0.5) * 3, 
                (Math.random() > 0.5 ? 1 : -1) * HORIZONTAL_SPIN_STRENGTH, 
                (Math.random() - 0.5) * 3 
            );
            
            slipperBody.wakeUp();

            camera.remove(slipperMesh);
            scene.add(slipperMesh);
            
            guideLine.visible = false;
            impactMarkerMesh.visible = false;
        }
        isMouseDown = false;
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDownHandler); 
    document.addEventListener('mouseup', onMouseUpHandler);

    // --- Ground ---
    const floorGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100);
    floorGeometry.rotateX(-Math.PI / 2); 
    
    const textureLoader = new THREE.TextureLoader();
    const grassTexture = textureLoader.load('https://placehold.co/512x512/34a853/ffffff?text=GRASS');
    grassTexture.wrapS = THREE.RepeatWrapping;
    grassTexture.wrapT = THREE.RepeatWrapping;
    grassTexture.repeat.set(50, 50); 

    const floorMaterial = new THREE.MeshLambertMaterial({ map: grassTexture });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    scene.add(floor);

    canJump = true;

    // --- Renderer Setup ---
    renderer = new THREE.WebGLRenderer({ antalias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    clock = new THREE.Clock();
    window.addEventListener('resize', onWindowResize);

    // Initial game setup
    resetGameComponents(true);
    scoreDisplay.textContent = `Score: ${hitCount}`;
}

// --- Resize Handler ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Checks if the can is knocked over and sets the state for the player to reset it.
 */
function checkCanState() {
    if (!can || isCanKnockedOverWaitingForReset || isGameOver) return;
    
    const wasKnockedDown = can.isKnockedDown;
    const isNowKnockedDown = can.checkState();

    if (isNowKnockedDown && !wasKnockedDown) {
        isCanKnockedOverWaitingForReset = true;
        startTimer();
    }
}


// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    if (isGameOver) {
        renderer.render(scene, camera);
        return;
    }
    
    const delta = clock.getDelta();

    // --- Player Movement ---
    if (controls.isLocked === true) {
        velocity.x -= velocity.x * FRICTION_MULTIPLIER * delta;
        velocity.z -= velocity.z * FRICTION_MULTIPLIER * delta;
        
        let currentGravity = BASE_GRAVITY;
        if (velocity.y < 0) {
            currentGravity *= FALL_GRAVITY_MULTIPLIER;
        }
        velocity.y += currentGravity * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        
        // Guard against normalizing a zero-length vector to prevent NaN values
        if (direction.lengthSq() > 1e-6) {
            direction.normalize();
        } else {
            direction.set(0, 0, 0);
        }

        if (moveForward || moveBackward) velocity.z -= direction.z * moveSpeed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * moveSpeed * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        let newPosY = controls.getObject().position.y + (velocity.y * delta);

        // Ground collision detection
        if (newPosY < PLAYER_HEIGHT) {
            velocity.y = 0; 
            newPosY = PLAYER_HEIGHT; 
            canJump = true;
        }

        controls.getObject().position.y = newPosY;

        // Player boundary constraints
        const player = controls.getObject();
        const halfSizeX = FIELD_SIZE_X / 2 - 10;
        const halfSizeZ = FIELD_SIZE_Z / 2 - 10;
        player.position.x = THREE.MathUtils.clamp(player.position.x, -halfSizeX, halfSizeX);
        player.position.z = THREE.MathUtils.clamp(player.position.z, -halfSizeZ, halfSizeZ);
    }

    // --- CANNON.js Physics Step ---
    const fixedTimeStep = 1 / 60;
    const maxSubSteps = 3;
    if (world) {
        world.step(fixedTimeStep, delta, maxSubSteps);
    }
    
    // --- Update Game Objects ---
    if (can) {
        can.update(false);
    }
    
    if (!isSlipperHeld) {
        slipperMesh.position.set(slipperBody.position.x, slipperBody.position.y, slipperBody.position.z);
        slipperMesh.quaternion.set(slipperBody.quaternion.x, slipperBody.quaternion.y, slipperBody.quaternion.z, slipperBody.quaternion.w);
    }

    // --- Game State Check ---
    checkCanState();

    // --- Throwing Zone / Can Reset Logic ---
    if (controls.isLocked) {
        const playerZ = controls.getObject().position.z;
        const isBehindLine = playerZ < FOUL_LINE_Z; 
        
        if (isBehindLine) {
            statusZone.textContent = 'Zone: IN';
            statusZone.className = `ui-score text-lg fixed top-5 right-20 bg-green-700`;
        } else {
            statusZone.textContent = 'Zone: OUT';
            statusZone.className = `ui-score text-lg fixed top-5 right-20 bg-red-700`;
        }
        
        // Check for can reset condition
        if (isCanKnockedOverWaitingForReset && isSlipperHeld && isBehindLine) {
            hitCount++;
            scoreDisplay.textContent = `Score: ${hitCount}`;
            stopTimer();
            resetTimer();
            can.reset();
            isCanKnockedOverWaitingForReset = false;
        }
    }

    // --- Guide Arch ---
    if (controls.isLocked && isSlipperHeld && isMouseDown) {
        drawGuideArch();
    } else {
        guideLine.visible = false;
        impactMarkerMesh.visible = false;
    }
    
    renderer.render(scene, camera);
}

// Initialize and start the loop
window.onload = function () {
    init();
    animate();
}