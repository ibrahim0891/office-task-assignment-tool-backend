import { Response } from "express";

/**
 * Reusable utility to send API responses consistently.
 * 
 * @param res Express Response object
 * @param statusCode HTTP status code
 * @param data Response body data (object, array, or error message structure)
 */
export const sendResponse = (res: Response, statusCode: number, data: any) => {
    return res.status(statusCode).json(data);
};
