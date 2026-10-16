import { Model, model } from "forge/models";

export class User extends Model {
  static override model = {
    email: model.string({ unique: true, maxLength: 320 }),
    name: model.string(),
  };
  static override timestamps = true;
}
