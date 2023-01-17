"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkRDSResource = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const ec2 = require("aws-cdk-lib/aws-ec2");
const secretsManager = require("aws-cdk-lib/aws-secretsmanager");
const rds = require("aws-cdk-lib/aws-rds");
const custom = require("aws-cdk-lib/custom-resources");
const iam = require("aws-cdk-lib/aws-iam");
class CdkRDSResource extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { applicationName, vpc, dbSecurityGroup, webTierRole, retentionSetting } = props;
        const { dbName, dbAdminUsername, dbWebUsername, dbStorageGB, dbMaxStorageGiB, dbMultiAZ, dbBackupRetentionDays, dbDeleteAutomatedBackups, dbPreferredBackupWindow, dbCloudwatchLogsExports, dbIamAuthentication, dbInstanceType } = props.databaseProps;
        /*
          Use Secrets Manager to create credentials for the Admin user for the RDS database
          Admin account is only used to create a dbwebusername, which the application uses to connect
          Admin credentials are preserved in Secrets Manager, in case of emergency.
          For now, credentials are not rotated
        */
        const dbCredentialsName = `${applicationName}-database-credentials`;
        const dbCredentials = new secretsManager.Secret(this, `${applicationName}-DBCredentialsSecret`, {
            secretName: dbCredentialsName,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    username: dbAdminUsername,
                }),
                excludePunctuation: true,
                includeSpace: false,
                generateStringKey: 'password'
            }
        });
        // Define a subnetGroup based on the isolated subnets from the VPC we created
        const rdsSubnetGroup = new rds.SubnetGroup(this, 'rds-subnet-group', {
            vpc: vpc,
            description: 'subnetgroup-db',
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED
            }
        });
        rdsSubnetGroup.applyRemovalPolicy(retentionSetting);
        // Define the configuration of the RDS instance
        const rdsConfig = {
            vpc,
            engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_14_1 }),
            instanceType: new ec2.InstanceType(dbInstanceType),
            instanceIdentifier: `${applicationName}`,
            allocatedStorage: dbStorageGB,
            maxAllocatedStorage: dbMaxStorageGiB,
            securityGroups: [dbSecurityGroup],
            credentials: rds.Credentials.fromSecret(dbCredentials),
            storageEncrypted: true,
            databaseName: dbName,
            multiAz: dbMultiAZ,
            backupRetention: aws_cdk_lib_1.Duration.days(dbBackupRetentionDays),
            deleteAutomatedBackups: dbDeleteAutomatedBackups,
            preferredBackupWindow: dbPreferredBackupWindow,
            publiclyAccessible: false,
            removalPolicy: retentionSetting,
            cloudwatchLogsExports: dbCloudwatchLogsExports,
            cloudwatchLogsRetention: dbBackupRetentionDays,
            subnetGroup: rdsSubnetGroup,
            iamAuthentication: dbIamAuthentication // Enables IAM authentication for the database
        };
        // create the Database instance, assign it to the public attribute so that the stack can read it from the construct
        this.rdsInstance = new rds.DatabaseInstance(this, `${applicationName}-instance`, rdsConfig);
        this.rdsCredentials = dbCredentials;
        this.rdsCredentialsName = dbCredentialsName;
        /*
          There is an issue with rdsInstance.grantConnect(myRole); In a nutshell, the permission created, doesn't actually
          create access based on the format defined here: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.IAMPolicy.html
          
          We still need to add permissions for the web-application to connect to the RDS database with IAM credentials
          A workaround was implemented based on: https://github.com/aws/aws-cdk/issues/11851
          
          For the permissions, we need access to the ResourceId of the instance.
          In a nutshell, we create a custom resource, which calls a Lambda function.
          This Lambda function calls the describeDBInstances api, and gets the resourceId
          We construct a proper policy, and attach it to the web instances' role.
        */
        if (dbIamAuthentication) {
            const { region, account, stackName } = aws_cdk_lib_1.Stack.of(this);
            const customResourceFnRole = new iam.Role(this, 'AwsCustomResourceRoleInfra', {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
            });
            customResourceFnRole.addToPolicy(new iam.PolicyStatement({
                resources: [`arn:aws:lambda:${region}:${account}:function:*-ResInit${stackName}`],
                actions: ['lambda:InvokeFunction']
            }));
            const dbResourceId = new custom.AwsCustomResource(this, 'RdsInstanceResourceId', {
                onCreate: {
                    service: 'RDS',
                    action: 'describeDBInstances',
                    parameters: {
                        DBInstanceIdentifier: this.rdsInstance.instanceIdentifier,
                    },
                    physicalResourceId: custom.PhysicalResourceId.fromResponse('DBInstances.0.DbiResourceId'),
                    outputPaths: ['DBInstances.0.DbiResourceId'],
                },
                policy: custom.AwsCustomResourcePolicy.fromSdkCalls({
                    resources: custom.AwsCustomResourcePolicy.ANY_RESOURCE,
                }),
                role: customResourceFnRole
            });
            const resourceId = dbResourceId.getResponseField('DBInstances.0.DbiResourceId');
            const dbUserArn = `arn:aws:rds-db:${region}:${account}:dbuser:${resourceId}/${dbWebUsername}`;
            webTierRole.addToPrincipalPolicy(new iam.PolicyStatement({
                actions: ['rds-db:connect'],
                resources: [dbUserArn]
            }));
        }
    }
}
exports.CdkRDSResource = CdkRDSResource;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmRzX2luZnJhc3RydWN0dXJlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicmRzX2luZnJhc3RydWN0dXJlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUF1QztBQUN2Qyw2Q0FBNkQ7QUFDN0QsMkNBQTJDO0FBQzNDLGlFQUFpRTtBQUNqRSwyQ0FBMkM7QUFDM0MsdURBQXNEO0FBQ3RELDJDQUEyQztBQTJCM0MsTUFBYSxjQUFlLFNBQVEsc0JBQVM7SUFLM0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEwQjtRQUNsRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFBO1FBRWhCLE1BQU0sRUFBRSxlQUFlLEVBQUUsR0FBRyxFQUFFLGVBQWUsRUFBRSxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUE7UUFDdEYsTUFBTSxFQUNKLE1BQU0sRUFDTixlQUFlLEVBQ2YsYUFBYSxFQUNiLFdBQVcsRUFDWCxlQUFlLEVBQ2YsU0FBUyxFQUNULHFCQUFxQixFQUNyQix3QkFBd0IsRUFDeEIsdUJBQXVCLEVBQ3ZCLHVCQUF1QixFQUN2QixtQkFBbUIsRUFDbkIsY0FBYyxFQUNmLEdBQUcsS0FBSyxDQUFDLGFBQWEsQ0FBQTtRQUV2Qjs7Ozs7VUFLRTtRQUNGLE1BQU0saUJBQWlCLEdBQUcsR0FBRyxlQUFlLHVCQUF1QixDQUFBO1FBQ25FLE1BQU0sYUFBYSxHQUFHLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsR0FBRyxlQUFlLHNCQUFzQixFQUFFO1lBQzlGLFVBQVUsRUFBRSxpQkFBaUI7WUFDN0Isb0JBQW9CLEVBQUU7Z0JBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25DLFFBQVEsRUFBRSxlQUFlO2lCQUMxQixDQUFDO2dCQUNGLGtCQUFrQixFQUFFLElBQUk7Z0JBQ3hCLFlBQVksRUFBRSxLQUFLO2dCQUNuQixpQkFBaUIsRUFBRSxVQUFVO2FB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LEVBQUUsTUFBTSxDQUFDLGtCQUFrQixDQUFDLFlBQVksQ0FBQyw2QkFBNkIsQ0FBQztvQkFDekYsV0FBVyxFQUFFLENBQUMsNkJBQTZCLENBQUM7aUJBQzdDO2dCQUNELE1BQU0sRUFBRSxNQUFNLENBQUMsdUJBQXVCLENBQUMsWUFBWSxDQUFDO29CQUNsRCxTQUFTLEVBQUUsTUFBTSxDQUFDLHVCQUF1QixDQUFDLFlBQVk7aUJBQ3ZELENBQUM7Z0JBQ0YsSUFBSSxFQUFFLG9CQUFvQjthQUMzQixDQUFDLENBQUM7WUFDSCxNQUFNLFVBQVUsR0FBRyxZQUFZLENBQUMsZ0JBQWdCLENBQzlDLDZCQUE2QixDQUM5QixDQUFBO1lBRUQsTUFBTSxTQUFTLEdBQUcsa0JBQWtCLE1BQU0sSUFBSSxPQUFPLFdBQVcsVUFBVSxJQUFJLGFBQWEsRUFBRSxDQUFBO1lBRTdGLFdBQVcsQ0FBQyxvQkFBb0IsQ0FDOUIsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO2dCQUN0QixPQUFPLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQztnQkFDM0IsU0FBUyxFQUFFLENBQUMsU0FBUyxDQUFDO2FBQ3ZCLENBQUMsQ0FDSCxDQUFBO1NBQ0Y7SUFDSCxDQUFDO0NBQ0Y7QUF0SUQsd0NBc0lDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBSZW1vdmFsUG9saWN5LCBEdXJhdGlvbiwgU3RhY2sgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBzZWNyZXRzTWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgcmRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZHMnO1xuaW1wb3J0ICogYXMgY3VzdG9tIGZyb20gJ2F3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXMnXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YWJhc2VQcm9wcyB7XG4gIHJlYWRvbmx5IGRiTmFtZTogc3RyaW5nO1xuICByZWFkb25seSBkYkFkbWluVXNlcm5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgZGJXZWJVc2VybmFtZTogc3RyaW5nO1xuICByZWFkb25seSBkYlN0b3JhZ2VHQjogbnVtYmVyO1xuICByZWFkb25seSBkYk1heFN0b3JhZ2VHaUI6IG51bWJlcjtcbiAgcmVhZG9ubHkgZGJNdWx0aUFaOiBib29sZWFuO1xuICByZWFkb25seSBkYkJhY2t1cFJldGVudGlvbkRheXM6IG51bWJlcjtcbiAgcmVhZG9ubHkgZGJEZWxldGVBdXRvbWF0ZWRCYWNrdXBzOiBib29sZWFuO1xuICByZWFkb25seSBkYlByZWZlcnJlZEJhY2t1cFdpbmRvdzogc3RyaW5nO1xuICByZWFkb25seSBkYkNsb3Vkd2F0Y2hMb2dzRXhwb3J0czogc3RyaW5nW107XG4gIHJlYWRvbmx5IGRiSWFtQXV0aGVudGljYXRpb246IGJvb2xlYW47XG4gIHJlYWRvbmx5IGRiSW5zdGFuY2VUeXBlOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGRiUmV0ZW50aW9uUG9saWN5OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2RrUkRTUmVzb3VyY2VQcm9wcyB7XG4gIHJlYWRvbmx5IGFwcGxpY2F0aW9uTmFtZTogc3RyaW5nO1xuICByZWFkb25seSBkYlNlY3VyaXR5R3JvdXA6IGVjMi5JU2VjdXJpdHlHcm91cDtcbiAgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcbiAgcmVhZG9ubHkgZGF0YWJhc2VQcm9wczogRGF0YWJhc2VQcm9wcztcbiAgcmVhZG9ubHkgd2ViVGllclJvbGU6IGlhbS5JUm9sZTtcbiAgcmVhZG9ubHkgcmV0ZW50aW9uU2V0dGluZzogUmVtb3ZhbFBvbGljeTtcbn1cblxuZXhwb3J0IGNsYXNzIENka1JEU1Jlc291cmNlIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IHJkc0luc3RhbmNlOiByZHMuSURhdGFiYXNlSW5zdGFuY2U7XG4gIHB1YmxpYyByZWFkb25seSByZHNDcmVkZW50aWFsczogc2VjcmV0c01hbmFnZXIuSVNlY3JldDtcbiAgcHVibGljIHJlYWRvbmx5IHJkc0NyZWRlbnRpYWxzTmFtZTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDZGtSRFNSZXNvdXJjZVByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKVxuXG4gICAgY29uc3QgeyBhcHBsaWNhdGlvbk5hbWUsIHZwYywgZGJTZWN1cml0eUdyb3VwLCB3ZWJUaWVyUm9sZSwgcmV0ZW50aW9uU2V0dGluZyB9ID0gcHJvcHNcbiAgICBjb25zdCB7XG4gICAgICBkYk5hbWUsXG4gICAgICBkYkFkbWluVXNlcm5hbWUsXG4gICAgICBkYldlYlVzZXJuYW1lLFxuICAgICAgZGJTdG9yYWdlR0IsXG4gICAgICBkYk1heFN0b3JhZ2VHaUIsXG4gICAgICBkYk11bHRpQVosXG4gICAgICBkYkJhY2t1cFJldGVudGlvbkRheXMsXG4gICAgICBkYkRlbGV0ZUF1dG9tYXRlZEJhY2t1cHMsXG4gICAgICBkYlByZWZlcnJlZEJhY2t1cFdpbmRvdyxcbiAgICAgIGRiQ2xvdWR3YXRjaExvZ3NFeHBvcnRzLFxuICAgICAgZGJJYW1BdXRoZW50aWNhdGlvbixcbiAgICAgIGRiSW5zdGFuY2VUeXBlXG4gICAgfSA9IHByb3BzLmRhdGFiYXNlUHJvcHNcblxuICAgIC8qIFxuICAgICAgVXNlIFNlY3JldHMgTWFuYWdlciB0byBjcmVhdGUgY3JlZGVudGlhbHMgZm9yIHRoZSBBZG1pbiB1c2VyIGZvciB0aGUgUkRTIGRhdGFiYXNlXG4gICAgICBBZG1pbiBhY2NvdW50IGlzIG9ubHkgdXNlZCB0byBjcmVhdGUgYSBkYndlYnVzZXJuYW1lLCB3aGljaCB0aGUgYXBwbGljYXRpb24gdXNlcyB0byBjb25uZWN0XG4gICAgICBBZG1pbiBjcmVkZW50aWFscyBhcmUgcHJlc2VydmVkIGluIFNlY3JldHMgTWFuYWdlciwgaW4gY2FzZSBvZiBlbWVyZ2VuY3kuXG4gICAgICBGb3Igbm93LCBjcmVkZW50aWFscyBhcmUgbm90IHJvdGF0ZWRcbiAgICAqL1xuICAgIGNvbnN0IGRiQ3JlZGVudGlhbHNOYW1lID0gYCR7YXBwbGljYXRpb25OYW1lfS1kYXRhYmFzZS1jcmVkZW50aWFsc2BcbiAgICBjb25zdCBkYkNyZWRlbnRpYWxzID0gbmV3IHNlY3JldHNNYW5hZ2VyLlNlY3JldCh0aGlzLCBgJHthcHBsaWNhdGlvbk5hbWV9LURCQ3JlZGVudGlhbHNTZWNyZXRgLCB7XG4gICAgICBzZWNyZXROYW1lOiBkYkNyZWRlbnRpYWxzTmFtZSxcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgIHNlY3JldFN0cmluZ1RlbXBsYXRlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgdXNlcm5hbWU6IGRiQWRtaW5Vc2VybmFtZSxcbiAgICAgICAgfSksXG4gICAgICAgIGV4Y2x1ZGVQdW5jdHVhdGlvbjogdHJ1ZSxcbiAgICAgICAgaW5jbHVkZVNwYWNlOiBmYWxzZSxcbiAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICdwYXNzd29yZCdcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIERlZmluZSBhIHN1Ym5ldEdyb3VwIGJhc2VkIG9uIHRoZSBpc29sYXRlZCBzdWJuZXRzIGZyb20gdGhlIFZQQyB3ZSBjcmVhdGVkXG4gICAgY29uc3QgcmRzU3VibmV0R3JvdXAgPSBuZXcgcmRzLlN1Ym5ldEdyb3VwKHRoaXMsICdyZHMtc3VibmV0LWdyb3VwJywge1xuICAgICAgdnBjOiB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ3N1Ym5ldGdyb3VwLWRiJyxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRFxuICAgICAgfVxuICAgIH0pXG4gICAgcmRzU3VibmV0R3JvdXAuYXBwbHlSZW1vdmFsUG9saWN5KHJldGVudGlvblNldHRpbmcpXG5cbiAgICAvLyBEZWZpbmUgdGhlIGNvbmZpZ3VyYXRpb24gb2YgdGhlIFJEUyBpbnN0YW5jZVxuICAgIGNvbnN0IHJkc0NvbmZpZzogcmRzLkRhdGFiYXNlSW5zdGFuY2VQcm9wcyA9IHtcbiAgICAgIHZwYyxcbiAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlSW5zdGFuY2VFbmdpbmUucG9zdGdyZXMoeyB2ZXJzaW9uOiByZHMuUG9zdGdyZXNFbmdpbmVWZXJzaW9uLlZFUl8xNF8xIH0pLFxuICAgICAgaW5zdGFuY2VUeXBlOiBuZXcgZWMyLkluc3RhbmNlVHlwZShkYkluc3RhbmNlVHlwZSksXG4gICAgICBpbnN0YW5jZUlkZW50aWZpZXI6IGAke2FwcGxpY2F0aW9uTmFtZX1gLFxuICAgICAgYWxsb2NhdGVkU3RvcmFnZTogZGJTdG9yYWdlR0IsXG4gICAgICBtYXhBbGxvY2F0ZWRTdG9yYWdlOiBkYk1heFN0b3JhZ2VHaUIsXG4gICAgICBzZWN1cml0eUdyb3VwczogW2RiU2VjdXJpdHlHcm91cF0sXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21TZWNyZXQoZGJDcmVkZW50aWFscyksIC8vIEdldCBib3RoIHVzZXJuYW1lIGFuZCBwYXNzd29yZCBmb3IgQWRtaW4gdXNlciBmcm9tIFNlY3JldHMgbWFuYWdlclxuICAgICAgc3RvcmFnZUVuY3J5cHRlZDogdHJ1ZSxcbiAgICAgIGRhdGFiYXNlTmFtZTogZGJOYW1lLFxuICAgICAgbXVsdGlBejogZGJNdWx0aUFaLFxuICAgICAgYmFja3VwUmV0ZW50aW9uOiBEdXJhdGlvbi5kYXlzKGRiQmFja3VwUmV0ZW50aW9uRGF5cyksIC8vIElmIHNldCB0byAwLCBubyBiYWNrdXBcbiAgICAgIGRlbGV0ZUF1dG9tYXRlZEJhY2t1cHM6IGRiRGVsZXRlQXV0b21hdGVkQmFja3VwcyxcbiAgICAgIHByZWZlcnJlZEJhY2t1cFdpbmRvdzogZGJQcmVmZXJyZWRCYWNrdXBXaW5kb3csXG4gICAgICBwdWJsaWNseUFjY2Vzc2libGU6IGZhbHNlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogcmV0ZW50aW9uU2V0dGluZyxcbiAgICAgIGNsb3Vkd2F0Y2hMb2dzRXhwb3J0czogZGJDbG91ZHdhdGNoTG9nc0V4cG9ydHMsXG4gICAgICBjbG91ZHdhdGNoTG9nc1JldGVudGlvbjogZGJCYWNrdXBSZXRlbnRpb25EYXlzLFxuICAgICAgc3VibmV0R3JvdXA6IHJkc1N1Ym5ldEdyb3VwLFxuICAgICAgaWFtQXV0aGVudGljYXRpb246IGRiSWFtQXV0aGVudGljYXRpb24gLy8gRW5hYmxlcyBJQU0gYXV0aGVudGljYXRpb24gZm9yIHRoZSBkYXRhYmFzZVxuICAgIH1cblxuICAgIC8vIGNyZWF0ZSB0aGUgRGF0YWJhc2UgaW5zdGFuY2UsIGFzc2lnbiBpdCB0byB0aGUgcHVibGljIGF0dHJpYnV0ZSBzbyB0aGF0IHRoZSBzdGFjayBjYW4gcmVhZCBpdCBmcm9tIHRoZSBjb25zdHJ1Y3RcbiAgICB0aGlzLnJkc0luc3RhbmNlID0gbmV3IHJkcy5EYXRhYmFzZUluc3RhbmNlKHRoaXMsIGAke2FwcGxpY2F0aW9uTmFtZX0taW5zdGFuY2VgLCByZHNDb25maWcpO1xuICAgIHRoaXMucmRzQ3JlZGVudGlhbHMgPSBkYkNyZWRlbnRpYWxzXG4gICAgdGhpcy5yZHNDcmVkZW50aWFsc05hbWUgPSBkYkNyZWRlbnRpYWxzTmFtZVxuXG4gICAgLypcbiAgICAgIFRoZXJlIGlzIGFuIGlzc3VlIHdpdGggcmRzSW5zdGFuY2UuZ3JhbnRDb25uZWN0KG15Um9sZSk7IEluIGEgbnV0c2hlbGwsIHRoZSBwZXJtaXNzaW9uIGNyZWF0ZWQsIGRvZXNuJ3QgYWN0dWFsbHlcbiAgICAgIGNyZWF0ZSBhY2Nlc3MgYmFzZWQgb24gdGhlIGZvcm1hdCBkZWZpbmVkIGhlcmU6IGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25SRFMvbGF0ZXN0L1VzZXJHdWlkZS9Vc2luZ1dpdGhSRFMuSUFNREJBdXRoLklBTVBvbGljeS5odG1sXG4gICAgICBcbiAgICAgIFdlIHN0aWxsIG5lZWQgdG8gYWRkIHBlcm1pc3Npb25zIGZvciB0aGUgd2ViLWFwcGxpY2F0aW9uIHRvIGNvbm5lY3QgdG8gdGhlIFJEUyBkYXRhYmFzZSB3aXRoIElBTSBjcmVkZW50aWFsc1xuICAgICAgQSB3b3JrYXJvdW5kIHdhcyBpbXBsZW1lbnRlZCBiYXNlZCBvbjogaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL2lzc3Vlcy8xMTg1MVxuICAgICAgXG4gICAgICBGb3IgdGhlIHBlcm1pc3Npb25zLCB3ZSBuZWVkIGFjY2VzcyB0byB0aGUgUmVzb3VyY2VJZCBvZiB0aGUgaW5zdGFuY2UuXG4gICAgICBJbiBhIG51dHNoZWxsLCB3ZSBjcmVhdGUgYSBjdXN0b20gcmVzb3VyY2UsIHdoaWNoIGNhbGxzIGEgTGFtYmRhIGZ1bmN0aW9uLiBcbiAgICAgIFRoaXMgTGFtYmRhIGZ1bmN0aW9uIGNhbGxzIHRoZSBkZXNjcmliZURCSW5zdGFuY2VzIGFwaSwgYW5kIGdldHMgdGhlIHJlc291cmNlSWRcbiAgICAgIFdlIGNvbnN0cnVjdCBhIHByb3BlciBwb2xpY3ksIGFuZCBhdHRhY2ggaXQgdG8gdGhlIHdlYiBpbnN0YW5jZXMnIHJvbGUuXG4gICAgKi9cbiAgICBpZiAoZGJJYW1BdXRoZW50aWNhdGlvbikge1xuICAgICAgY29uc3QgeyByZWdpb24sIGFjY291bnQsIHN0YWNrTmFtZSB9ID0gU3RhY2sub2YodGhpcylcbiAgICAgIGNvbnN0IGN1c3RvbVJlc291cmNlRm5Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdBd3NDdXN0b21SZXNvdXJjZVJvbGVJbmZyYScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJylcbiAgICAgIH0pXG4gICAgICBjdXN0b21SZXNvdXJjZUZuUm9sZS5hZGRUb1BvbGljeShcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmxhbWJkYToke3JlZ2lvbn06JHthY2NvdW50fTpmdW5jdGlvbjoqLVJlc0luaXQke3N0YWNrTmFtZX1gXSxcbiAgICAgICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbiddXG4gICAgICAgIH0pXG4gICAgICApXG4gICAgICBjb25zdCBkYlJlc291cmNlSWQgPSBuZXcgY3VzdG9tLkF3c0N1c3RvbVJlc291cmNlKHRoaXMsICdSZHNJbnN0YW5jZVJlc291cmNlSWQnLCB7XG4gICAgICAgIG9uQ3JlYXRlOiB7XG4gICAgICAgICAgc2VydmljZTogJ1JEUycsXG4gICAgICAgICAgYWN0aW9uOiAnZGVzY3JpYmVEQkluc3RhbmNlcycsXG4gICAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgICAgREJJbnN0YW5jZUlkZW50aWZpZXI6IHRoaXMucmRzSW5zdGFuY2UuaW5zdGFuY2VJZGVudGlmaWVyLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBjdXN0b20uUGh5c2ljYWxSZXNvdXJjZUlkLmZyb21SZXNwb25zZSgnREJJbnN0YW5jZXMuMC5EYmlSZXNvdXJjZUlkJyksXG4gICAgICAgICAgb3V0cHV0UGF0aHM6IFsnREJJbnN0YW5jZXMuMC5EYmlSZXNvdXJjZUlkJ10sXG4gICAgICAgIH0sXG4gICAgICAgIHBvbGljeTogY3VzdG9tLkF3c0N1c3RvbVJlc291cmNlUG9saWN5LmZyb21TZGtDYWxscyh7XG4gICAgICAgICAgcmVzb3VyY2VzOiBjdXN0b20uQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuQU5ZX1JFU09VUkNFLFxuICAgICAgICB9KSxcbiAgICAgICAgcm9sZTogY3VzdG9tUmVzb3VyY2VGblJvbGVcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcmVzb3VyY2VJZCA9IGRiUmVzb3VyY2VJZC5nZXRSZXNwb25zZUZpZWxkKFxuICAgICAgICAnREJJbnN0YW5jZXMuMC5EYmlSZXNvdXJjZUlkJ1xuICAgICAgKVxuXG4gICAgICBjb25zdCBkYlVzZXJBcm4gPSBgYXJuOmF3czpyZHMtZGI6JHtyZWdpb259OiR7YWNjb3VudH06ZGJ1c2VyOiR7cmVzb3VyY2VJZH0vJHtkYldlYlVzZXJuYW1lfWBcblxuICAgICAgd2ViVGllclJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbJ3Jkcy1kYjpjb25uZWN0J10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbZGJVc2VyQXJuXVxuICAgICAgICB9KVxuICAgICAgKVxuICAgIH1cbiAgfVxufSJdfQ==