import { Model, model } from "forge/models";

export class Tag extends Model {
  static override model = {
    label: model.string({ unique: true, maxLength: 50 }),
  };
}
