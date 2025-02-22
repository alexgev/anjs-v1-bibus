import { FastifyRequest } from "fastify";
import { FromSchema } from "json-schema-to-ts";
import { UserEmail } from "../../../models/user-email";
import { SuccessResponse } from "../../../utils/responses";
import { EmailSender } from "../email-sender";
import { AuthRequestTokenBodySchema } from "./req-res";

export const requestToken = 
  (emailSender: EmailSender) => 
  async (request: FastifyRequest<{Body: FromSchema<typeof AuthRequestTokenBodySchema>}>): Promise<SuccessResponse> => {
    const userEmail = await UserEmail.findOne({
      where: {
        main: true,
        value: request.body.email,
      },
      relations: ["user"]
    })

    if (!userEmail) {
      return SuccessResponse.create(request.id);
    }

    const user = userEmail.user

    // . Create new token
    await user.createNewToken()

    // . Get this last token
    const token = await user.lastTempToken()

    if (!token) {
      throw new Error(`There is no token`)
    }

    // . Send email with token
    await emailSender.sendEmail(`Your token is ${token.id}`, user.mainEmail().value)

    // . Success
    return SuccessResponse.create(request.id);
  }