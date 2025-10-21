// can.ts
declare const THREE: any;
declare const CANNON: any;

// --- Constants for the Can ---
export const CAN_TARGET_X = 0;
export const CAN_TARGET_Z = 120;
export const CAN_RADIUS = 4;
export const CAN_HEIGHT = 10;
export const CAN_HALF_HEIGHT = CAN_HEIGHT / 2;
export const CAN_MASS = 0.15;

export class Can {
    public mesh: any;
    public body: any;
    public originalPosition: any;
    private originalMaterial: any;
    private isKnockedDownState: boolean = false;

    constructor(scene: any, world: any) {
        // --- 1. Create the Visual Mesh (THREE.js) ---
        const geometry = new THREE.CylinderGeometry(CAN_RADIUS, CAN_RADIUS, CAN_HEIGHT, 32);
        this.originalMaterial = new THREE.MeshPhongMaterial({
            color: 0xcc3333,
            specular: 0x555555,
            shininess: 80
        });
        this.mesh = new THREE.Mesh(geometry, this.originalMaterial);
        this.mesh.userData = { isGameCan: true }; // Identifier for interactions
        scene.add(this.mesh);

        // --- 2. Create the Physics Body (CANNON.js) ---
        const shape = new CANNON.Cylinder(CAN_RADIUS, CAN_RADIUS, CAN_HEIGHT, 32);
        const canMaterial = new CANNON.Material('canMaterial');
        this.body = new CANNON.Body({
            mass: CAN_MASS,
            shape: shape,
            allowSleep: true,
            angularDamping: 0.95,    // Increased damping
            linearDamping: 0.95,     // Add linear damping
            material: canMaterial
        });

        // Set physical properties on the material
        this.body.material.friction = 0.8;
        this.body.material.restitution = 0.1;
        
        // Add small vertical offset for stability
        this.originalPosition = new CANNON.Vec3(CAN_TARGET_X, CAN_HALF_HEIGHT + 0.1, CAN_TARGET_Z);
        this.body.position.copy(this.originalPosition);
        world.addBody(this.body);

        // Put the body to sleep initially so it doesn't wobble
        this.body.sleep();

        // Initial synchronization
        this.update(false);
    }

    /**
     * Synchronizes the visual mesh's position and orientation with the physics body.
     * @param isCarried - If true, the NPC is controlling the can, so don't update from physics.
     */
    public update(isCarried: boolean): void {
        if (isCarried) return;

        this.mesh.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
        this.mesh.quaternion.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w);
    }

    /**
     * Checks if the can is knocked over by examining its orientation.
     * @returns {boolean} True if the can is considered fallen.
     */
    public checkState(): boolean {
        // If already knocked down, no need to check again until it's reset.
        if (this.isKnockedDownState) {
            return true;
        }

        const localUp = new CANNON.Vec3(0, 1, 0); // Can's local "up" vector
        const worldUp = this.body.quaternion.vmult(localUp); // "Up" vector in world space

        // Consider fallen if tilted more than 60 degrees (cos(60) = 0.5)
        const isFallen = worldUp.y < 0.5;
        
        if (isFallen) {
            this.isKnockedDownState = true;
        }
        
        return isFallen;
    }

    /**
     * Resets the can to its original starting position, orientation, and physical state.
     */
    public reset(): void {
        this.body.position.copy(this.originalPosition);
        this.body.quaternion.set(0, 0, 0, 1);
        this.body.velocity.set(0, 0, 0);
        this.body.angularVelocity.set(0, 0, 0);
        this.body.sleep(); // Put to sleep on reset for stability

        this.isKnockedDownState = false;
        
        // Ensure mesh is synced immediately after reset
        this.update(false);
    }
    
    /**
     * Makes the can a static body (non-physical), typically when being carried by the NPC.
     */
    public disablePhysics(): void {
        this.body.mass = 0;
        this.body.type = CANNON.Body.STATIC;
        this.body.updateMassProperties();
    }
    
    /**
     * Re-enables the can's physics, making it a dynamic body again.
     */
    public enablePhysics(): void {
        this.body.mass = CAN_MASS;
        this.body.type = CANNON.Body.DYNAMIC;
        this.body.updateMassProperties();
        this.body.wakeUp();
    }
    
    // --- Getters for external access ---
    
    public get isKnockedDown(): boolean {
        return this.isKnockedDownState;
    }
}