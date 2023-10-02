import { getUserByExternalId } from "../../services/users";
import { createApiRequestHandler } from "../../util/handler";

export const getUser = createApiRequestHandler()(
  async (req: any): Promise<any> => {
    console.log("get User by ID endpoint hit");

    const userId = req.params.id;

    console.log("userId", userId);

    const user = await getUserByExternalId(userId);

    console.log("user", user);

    if (!user) {
      console.log("about to return an empty list");
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    const org = req.organization;

    const orgUser = org.members.find((member: any) => member.id === user?.id);

    if (!orgUser) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 0,
        Resources: [],
        startIndex: 1,
        itemsPerPage: 20,
      };
    }

    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: req.params.id,
      userName: user.email,
      name: {
        displayName: user.name,
      },
      active: true,
      emails: [
        {
          primary: true,
          value: user.email,
          type: "work",
          display: user.email,
        },
      ],
      role: orgUser.role,
      groups: [],
      meta: {
        resourceType: "User",
      },
    };
  }
);