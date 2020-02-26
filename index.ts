import * as path from 'path';
import * as cfn from '@aws-cdk/aws-cloudformation';
import * as s3Assets from '@aws-cdk/aws-s3-assets';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as kms from '@aws-cdk/aws-kms';
import * as secretsManager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';
import * as customResource from '@aws-cdk/custom-resources';

export type SopsSecretsManagerEncoding = 'string' | 'json';

export type SopsSecretsManagerFileType = 'yaml' | 'json';

export interface SopsSecretsManagerMapping {
    path: Array<string>;
    encoding?: SopsSecretsManagerEncoding;
}

export interface SopsSecretsManagerMappings {
    [key: string]: SopsSecretsManagerMapping;
}

export interface SopsSecretsManagerProps {
    readonly secret?: secretsManager.ISecret;
    readonly secretName?: string;
    readonly asset: s3Assets.Asset;
    readonly kmsKey: kms.IKey;
    readonly mappings: SopsSecretsManagerMappings;
    readonly fileType?: SopsSecretsManagerFileType;
}

class SopsSecretsManagerProvider extends cdk.Construct {
    public readonly provider: customResource.Provider;

    public static getOrCreate(scope: cdk.Construct): customResource.Provider {
        const stack = cdk.Stack.of(scope);
        const id = 'com.isotoma.cdk.custom-resources.sops-secrets-manager';
        const x = (stack.node.tryFindChild(id) as SopsSecretsManagerProvider) || new SopsSecretsManagerProvider(stack, id);
        return x.provider;
    }

    constructor(scope: cdk.Construct, id: string) {
        super(scope, id);

        this.provider = new customResource.Provider(this, 'sops-secrets-manager-provider', {
            onEventHandler: new lambda.Function(this, 'sops-secrets-manager-event', {
                code: lambda.Code.fromAsset(path.join(__dirname, 'provider')),
                runtime: lambda.Runtime.PYTHON_3_8,
                handler: 'main.on_event',
                timeout: cdk.Duration.minutes(5),
                initialPolicy: [
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['s3:GetObject*', 's3:GetBucket*', 's3:List*', 's3:DeleteObject*', 's3:PutObject*', 's3:Abort*'],
                    }),
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['kms:*'],
                    }),
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['secretsmanager:*'],
                    }),
                ],
            }),
        });
    }
}

export class SopsSecretsManager extends cdk.Construct {
    public readonly secret: secretsManager.ISecret;

    constructor(scope: cdk.Construct, id: string, props: SopsSecretsManagerProps) {
        super(scope, id);

        this.secret = this.getSecret(props.secret, props.secretName);

        const resource = new cfn.CustomResource(this, 'Resource', {
            provider: SopsSecretsManagerProvider.getOrCreate(this),
            resourceType: 'Custom::SopsSecretsManager',
            properties: {
                SecretArn: this.secret.secretArn,
                S3Bucket: props.asset.s3BucketName,
                S3Path: props.asset.s3ObjectKey,
                SourceHash: props.asset.sourceHash,
                KMSKeyArn: props.kmsKey.keyArn,
                Mappings: JSON.stringify(props.mappings),
                FileType: props.fileType,
            },
        });
    }

    public getSecret(secret?: secretsManager.ISecret, secretName?: string): secretsManager.ISecret {
        if (secret && secretName) {
            throw new Error('Cannot set both secret and secretName');
        }

        if (secret) {
            return secret;
        }

        if (secretName) {
            return new secretsManager.Secret(this, 'Secret', {
                secretName,
            });
        }

        throw new Error('Must set one of secret or secretName');
    }
}