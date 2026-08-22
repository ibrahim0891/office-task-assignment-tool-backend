import { Request, Response } from "express";
import { sendResponse } from "../../utils/response";
import * as authService from "./auth.service";

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body;
    try {
        const result = await authService.loginUser(email, password);
        sendResponse(res, 200, result);
    } catch (error: any) {
        if (error.message === "Invalid email or password.") {
            return sendResponse(res, 401, { error: error.message });
        }
        if (error.message === "EMAIL_NOT_VERIFIED") {
            return sendResponse(res, 403, { error: "Email not verified.", email });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const register = async (req: Request, res: Response) => {
    const { fullName, email, password } = req.body;
    try {
        const result = await authService.registerUser(fullName, email, password);
        sendResponse(res, 201, result);
    } catch (error: any) {
        if (error.message === "User with this email already exists.") {
            return sendResponse(res, 400, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};

export const verifyEmail = async (req: Request, res: Response) => {
    const { email, code } = req.body;
    try {
        const result = await authService.verifyEmailCode(email, code);
        sendResponse(res, 200, result);
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
};

export const resendVerification = async (req: Request, res: Response) => {
    const { email } = req.body;
    try {
        await authService.sendNewVerificationCode(email);
        sendResponse(res, 200, { message: "Verification code sent." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
};

export const forgotPassword = async (req: Request, res: Response) => {
    const { email } = req.body;
    try {
        await authService.sendResetPasswordCode(email);
        sendResponse(res, 200, { message: "Password reset code sent." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
};

export const resetPassword = async (req: Request, res: Response) => {
    const { email, code, newPassword } = req.body;
    try {
        await authService.resetPasswordWithCode(email, code, newPassword);
        sendResponse(res, 200, { message: "Password reset successfully." });
    } catch (error: any) {
        sendResponse(res, 400, { error: error.message });
    }
};
