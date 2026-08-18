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
        sendResponse(res, 500, { error: error.message });
    }
};

export const register = async (req: Request, res: Response) => {
    const { name, email, password } = req.body;
    try {
        const result = await authService.registerUser(name, email, password);
        sendResponse(res, 201, result);
    } catch (error: any) {
        if (error.message === "User with this email already exists.") {
            return sendResponse(res, 400, { error: error.message });
        }
        sendResponse(res, 500, { error: error.message });
    }
};
