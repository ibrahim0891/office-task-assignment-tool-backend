import { Router } from "express";
import * as usersController from "./users.controller";
import { resolveWorkspaceContext, requireLeader } from "../../middleware/auth";

const router = Router();

router.get(
    "/users/exclude-team/:teamId",
    resolveWorkspaceContext,
    usersController.getExcludeTeam,
);
router.get("/users", usersController.getUsers);
router.get("/users/profile/:userId", usersController.getProfile);
router.put("/users/profile/:userId", usersController.updateProfile);
router.get("/teams", usersController.getTeams);

router.post(
    "/teams/:teamId/members/remove",
    requireLeader,
    usersController.removeMember,
);
router.post(
    "/teams/:teamId/members/add",
    requireLeader,
    usersController.addMember,
);
router.post(
    "/teams/:teamId/members/invite-by-email",
    requireLeader,
    usersController.inviteMember,
);
router.put(
    "/teams/:teamId/members/role",
    requireLeader,
    usersController.updateMemberRole,
);
router.post("/teams", usersController.createTeam);
router.put(
    "/teams/:teamId",
    resolveWorkspaceContext,
    usersController.updateTeamName,
);
router.delete("/teams/:teamId", requireLeader, usersController.deleteTeam);

export default router;
