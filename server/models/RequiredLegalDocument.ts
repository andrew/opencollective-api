import { CreationOptional, InferAttributes, Model } from 'sequelize';

import sequelize, { DataTypes } from '../lib/sequelize';

import { LEGAL_DOCUMENT_TYPE } from './LegalDocument';

class RequiredLegalDocument extends Model<
  InferAttributes<RequiredLegalDocument>,
  InferAttributes<RequiredLegalDocument>
> {
  public declare readonly id: CreationOptional<number>;
  public declare documentType: LEGAL_DOCUMENT_TYPE;
  public declare HostCollectiveId: number;

  public declare createdAt: CreationOptional<Date>;
  public declare updatedAt: CreationOptional<Date>;
  public declare deletedAt: CreationOptional<Date>;
}

RequiredLegalDocument.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    documentType: {
      type: DataTypes.ENUM,
      values: ['US_TAX_FORM'],
      allowNull: false,
      defaultValue: 'US_TAX_FORM',
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    deletedAt: {
      type: DataTypes.DATE,
    },
    HostCollectiveId: {
      type: DataTypes.INTEGER,
      references: {
        model: 'Collectives',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      allowNull: false,
    },
  },
  {
    sequelize,
  },
);

export default RequiredLegalDocument;
