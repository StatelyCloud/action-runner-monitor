// @generated by Stately. DO NOT EDIT.
/* eslint-disable */

import type { Message } from "@bufbuild/protobuf";
import type {
  GenEnum,
  GenFile,
  GenMessage,
} from "@bufbuild/protobuf/codegenv1";

export declare const file_stately: GenFile;

/**
 * OutageEvent records a period when a runner was in an unhealthy state
 *
 * This item can be accessed via the following key paths:
 *   * /repo-:repoId/history-:runnerId/outage-:outageId
 */
export declare type OutageEvent =
  Message<"stately.generated.stately.OutageEvent"> & {
    outageId: bigint;

    repoId: string;

    runnerId: bigint;

    status: RunnerStatus;

    startedAt: bigint;

    resolvedAt: bigint;

    description: string;

    notificationSent: boolean;

    createdAt: bigint;

    updatedAt: bigint;

    runnerName: string;
  };

/**
 * Describes the message stately.generated.OutageEvent.
 * Use `create(OutageEventSchema)` to create a new message.
 */
export declare const OutageEventSchema: GenMessage<OutageEvent>;

/**
 * Repository information
 * Primary grouping entity for runners
 *
 * This item can be accessed via the following key paths:
 *   * /repo-:repoId
 */
export declare type Repository =
  Message<"stately.generated.stately.Repository"> & {
    repoId: string;

    owner: string;

    name: string;

    isActive: boolean;

    createdAt: bigint;

    lastSyncedAt: bigint;
  };

/**
 * Describes the message stately.generated.Repository.
 * Use `create(RepositorySchema)` to create a new message.
 */
export declare const RepositorySchema: GenMessage<Repository>;

/**
 * Runner information
 * Stores metadata and current status for each GitHub runner
 *
 * This item can be accessed via the following key paths:
 *   * /repo-:repoId/runner-:name
 */
export declare type Runner = Message<"stately.generated.stately.Runner"> & {
  runnerId: bigint;

  repoId: string;

  name: string;

  status: RunnerStatus;

  enabled: boolean;

  os: string;

  labels: Label[];

  lastSeenAt: bigint;

  firstSeenAt: bigint;

  createdAt: bigint;

  updatedAt: bigint;
};

/**
 * Describes the message stately.generated.Runner.
 * Use `create(RunnerSchema)` to create a new message.
 */
export declare const RunnerSchema: GenMessage<Runner>;
/**
 * Label object to store runner capabilities/labels
 */
export declare type Label = Message<"stately.generated.stately.Label"> & {
  name: string;
};

/**
 * Describes the message stately.generated.Label.
 * Use `create(LabelSchema)` to create a new message.
 */
export declare const LabelSchema: GenMessage<Label>;

/**
 * Enumeration of possible runner statuses
 */
export enum RunnerStatus {
  /**
   * The zero value for RunnerStatus, used when it is not set to any other value.
   */
  RunnerStatus_UNSPECIFIED = 0,
  /**
   */
  RunnerStatus_ONLINE = 1,
  /**
   */
  RunnerStatus_OFFLINE = 2,
  /**
   */
  RunnerStatus_BUSY = 3,
  /**
   */
  RunnerStatus_UNKNOWN = 4,
  /**
   */
  RunnerStatus_IDLE = 5,
}

/**
 * Describes the enum stately.generated.RunnerStatus.
 */
export declare const RunnerStatusSchema: GenEnum<RunnerStatus>;
