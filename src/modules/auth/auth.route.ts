import { Router } from "express";
import * as authController from "./auth.controller";

const router = Router();

router.post("/login", authController.login);
router.post("/register", authController.register);
router.post("/verify-email", authController.verifyEmail);
router.post("/resend-verification", authController.resendVerification);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

export default router;
