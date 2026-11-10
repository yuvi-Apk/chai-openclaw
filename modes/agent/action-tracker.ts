import type {ActionLog,ActionStatus} from "./types";
import {isMutationType} from "./types";

export class ActionTracker {

    private actions: ActionLog[] = [];

    log(
        entry:Omit<ActionLog,"id"|"timestamp"|"status"> & {
            id?: string;
            timestamp?: Date;
            status?: ActionStatus;
        }
    ){
        const action: ActionLog = {
            id: entry.id || crypto.randomUUID(),
            timestamp: entry.timestamp || new Date(),
            type: entry.type,
            path: entry.path,
            details: {...entry.details},
            status: entry.status || 'pending',
            userApproved: entry.userApproved,
        };
        this.actions.push(action);
        return action;
    }

    getActions():readonly ActionLog[] {
        return this.actions;
    }

    getPendingMutations():ActionLog[] {
        return this.actions.filter((action) => isMutationType(action.type) && action.status === 'pending');
    }

    updateActionStatus(id:string, status:ActionStatus, userApproved?:boolean):boolean {
        const action = this.actions.find((action) => action.id === id);
        if(!action) return false;
        action.status = status;
        if(userApproved !== undefined) {
            action.userApproved = userApproved;
        }
        return true;
    }
}