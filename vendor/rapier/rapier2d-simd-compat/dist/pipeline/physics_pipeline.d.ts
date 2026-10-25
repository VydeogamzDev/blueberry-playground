import { RawPhysicsPipeline } from "../raw";
import { Vector } from "../math";
import { IntegrationParameters, ImpulseJointSet, MultibodyJointSet, RigidBodyHandle, RigidBodySet, CCDSolver, IslandManager, SoftBodySet } from "../dynamics";
import { BroadPhase, ColliderSet, NarrowPhase } from "../geometry";
import { EventQueue } from "./event_queue";
import { PhysicsHooks } from "./physics_hooks";
export declare class PhysicsPipeline {
    /**
     * Keeps two bodies' colliders from touching, once more (or once less: `excluded` false),
     * where either collider's contact-filter rules ask (see `Collider.setContactFilter`).
     */
    setBodyPairExcluded(body1: RigidBodyHandle, body2: RigidBodyHandle, excluded: boolean): void;
    /** Forgets every pair kept apart with this body (it's being removed). */
    forgetBodyPairs(body: RigidBodyHandle): void;
    raw: RawPhysicsPipeline;
    free(): void;
    constructor(raw?: RawPhysicsPipeline);
    step(gravity: Vector, integrationParameters: IntegrationParameters, islands: IslandManager, broadPhase: BroadPhase, narrowPhase: NarrowPhase, bodies: RigidBodySet, colliders: ColliderSet, softBodies: SoftBodySet, impulseJoints: ImpulseJointSet, multibodyJoints: MultibodyJointSet, ccdSolver: CCDSolver, eventQueue?: EventQueue, hooks?: PhysicsHooks): void;
}
