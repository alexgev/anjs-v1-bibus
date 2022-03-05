import {AuthLoginBodySchema, AuthRegisterBodySchema, AuthRequestTokenBodySchema} from "controllers/auth.req-res";
import { FastifyRequest} from "fastify";
import {FromSchema} from "json-schema-to-ts";
import {TempToken} from "models/temp-token";
import {User} from "models/user";
import {UserEmail} from "models/user-email";
import pino from "pino";
import {JWTToken} from "utils/jwt-tokens";
import {SuccessResponse, SuccessResponseR, SuccessResponseWR} from "utils/responses";

type EmailSender = {
  sendEmail: (message: string, email: string) => Promise<void>
}

export class AuthController {
  constructor(
    private logger: pino.Logger,
    private emailSender: EmailSender,
    private privateKey: string,
  ) {}

  async register(request: FastifyRequest<{Body: FromSchema<typeof AuthRegisterBodySchema>}>): Promise<SuccessResponseWR> {
    // . Check email
    if (await UserEmail.checkEmailExist(request.body.email)) {
      throw new Error(`User with email ${request.body.email} already exist`)
    }

    // . Create new user, email and passwordless token
    const user = await User.registerUser(request.body.email)
    await user.save()

    // . Send token to email
    const token = await user.lastTempToken()
    const email = user.mainEmail()

    if (!token || !email) {
      throw new Error("Something went wrong")
    }

    await this.emailSender.sendEmail(`Your token is ${token.id}`, email.value)

    // . Return User
    return SuccessResponse.create(request.id)
  }

  async requestToken(request: FastifyRequest<{Body: FromSchema<typeof AuthRequestTokenBodySchema>}>): Promise<SuccessResponseWR> {
    // . Get user email for token
    const userEmail = await UserEmail.findOne({
      where: {
        main: true,
        value: request.body.email,
      },
      relations: ["user"]
    })

    if (!userEmail) {
      return SuccessResponse.create(request.id)
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
    await this.emailSender.sendEmail(`Your token is ${token.id}`, user.mainEmail().value)

    // . Success
    return SuccessResponse.create(request.id)
  }

  async login(request: FastifyRequest<{Body: FromSchema<typeof AuthLoginBodySchema>}>): Promise<SuccessResponseR<{token: string}>> {
    // . Get temp token with user
    const tempToken = await TempToken.findOne({
      where: {
        id: request.body.tempToken,
        used: false,
        userEmail: {
          value: request.body.email,
          main: true,
        }
      },
      relations: [
        "userEmail",
        "userEmail.user"
      ]
    })

    if (!tempToken) {
      throw new Error(`There is no unused token with id ${request.body.tempToken}`)
    }

    // . Login
    const user = tempToken.userEmail.user
    await user.loginByTempToken(tempToken)
    await user.save()

    // . Create JWT for User
    const jwtToken = user.lastJwtToken()

    if (!jwtToken) {
      throw new Error(`No JWT Token`)
    }

    // . Send JWT
    return SuccessResponse.create(request.id, {
      token: JWTToken.sign(this.privateKey, {
        id: jwtToken.id,
        userId: user.id,
        userEmail: user.mainEmail().value,
      }),
    })
  }

  async logout(request: FastifyRequest): Promise<SuccessResponseWR> {
    // . Check auth
    if (!request.userId) {
      throw new Error(`Permission denied`);
    }

    // . Get User
    const user = await User.findOne({
      where: {
        id: request.userId,
      }
    })

    if (!user) {
      throw new Error(`User must be`)
    }

    // . Logout
    await user.logout()

    // . Success
    return SuccessResponse.create(request.id)
  }
}
