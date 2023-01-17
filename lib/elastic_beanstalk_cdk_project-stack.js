"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElasticBeanstalkCdkStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const logs = require("aws-cdk-lib/aws-logs");
const ec2 = require("aws-cdk-lib/aws-ec2");
const elasticbeanstalk = require("aws-cdk-lib/aws-elasticbeanstalk");
const s3 = require("aws-cdk-lib/aws-s3");
const iam = require("aws-cdk-lib/aws-iam");
const s3Deploy = require("aws-cdk-lib/aws-s3-deployment");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const rds_initialiser_1 = require("./rds_initialiser");
const rds_infrastructure_1 = require("./rds_infrastructure");
class ElasticBeanstalkCdkStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id);
        const { applicationName, instanceType, vpcName, vpcCidr, loadbalancerInboundCIDR, loadbalancerOutboundCIDR, webserverOutboundCIDR, zipFileName, solutionStackName, managedActionsEnabled, updateLevel, preferredUpdateStartTime, streamLogs, deleteLogsOnTerminate, logRetentionDays, loadBalancerType, lbHTTPSEnabled, lbHTTPSCertificateArn, lbSSLPolicy, } = props;
        if (lbHTTPSEnabled && lbHTTPSCertificateArn === "") {
            throw new Error("Please provide a certificate ARN in cdk.json, or disable HTTPS for testing purposes");
        }
        console.log("Configuration settings: ", props);
        const { dbWebUsername, dbName, dbRetentionPolicy } = props.databaseSettings; // get some database settings
        let retentionPolicy;
        switch (dbRetentionPolicy) {
            case "destroy":
                retentionPolicy = aws_cdk_lib_1.RemovalPolicy.DESTROY;
                break;
            case "snapshot":
                retentionPolicy = aws_cdk_lib_1.RemovalPolicy.SNAPSHOT;
                break;
            default: retentionPolicy = aws_cdk_lib_1.RemovalPolicy.RETAIN;
        }
        // Create an encrypted bucket for deployments and log storage
        // S3 Bucket needs a specific format for deployment + logs: https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/AWSHowTo.S3.html
        const encryptedBucket = new s3.Bucket(this, 'EBEncryptedBucket', {
            bucketName: `elasticbeanstalk-${this.region}-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            serverAccessLogsPrefix: 'server_access_logs',
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        /*
          Create a VPC with three subnets, spread across two AZs:
          1. Private subnet with route to NAT Gateway for the webinstances
          2. Private subnet without NAT Gateway (isolated) for the database instance
          3. Public subnet with Internet Gateway + NAT Gateway for public access for ALB and NAT Gateway access from Web instances
          
          Store VPC flow logs in the encrypted bucket we created above
        */
        const vpc = new ec2.Vpc(this, vpcName, {
            natGateways: 1,
            maxAzs: 2,
            cidr: vpcCidr,
            flowLogs: {
                's3': {
                    destination: ec2.FlowLogDestination.toS3(encryptedBucket, 'vpc-flow-logs'),
                    trafficType: ec2.FlowLogTrafficType.ALL
                }
            },
            subnetConfiguration: [
                {
                    name: 'private-with-nat',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
                },
                {
                    name: 'private-isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
                {
                    name: 'public',
                    subnetType: ec2.SubnetType.PUBLIC,
                }
            ]
        });
        vpc.node.addDependency(encryptedBucket);
        // Upload the example ZIP file to the deployment bucket 
        const appDeploymentZip = new s3Deploy.BucketDeployment(this, "DeployZippedApplication", {
            sources: [s3Deploy.Source.asset(`${__dirname}/../src/deployment_zip`)],
            destinationBucket: encryptedBucket
        });
        // Define a new Elastic Beanstalk application
        const app = new elasticbeanstalk.CfnApplication(this, 'Application', {
            applicationName: applicationName,
        });
        // Create role for the web-instances
        const webtierRole = new iam.Role(this, `${applicationName}-webtier-role`, {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        });
        // Add a managed policy for the ELastic Beanstalk web-tier to the webTierRole
        const managedPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName('AWSElasticBeanstalkWebTier');
        webtierRole.addManagedPolicy(managedPolicy);
        // Create an instance profile for the web-instance role
        const ec2ProfileName = `${applicationName}-EC2WebInstanceProfile`;
        const ec2InstanceProfile = new iam.CfnInstanceProfile(this, ec2ProfileName, {
            instanceProfileName: ec2ProfileName,
            roles: [webtierRole.roleName]
        });
        // Create Security Group for load balancer
        const lbSecurityGroup = new ec2.SecurityGroup(this, 'LbSecurityGroup', {
            vpc: vpc,
            description: "Security Group for the Load Balancer",
            securityGroupName: "lb-security-group-name",
            allowAllOutbound: false
        });
        // Determine if HTTP or HTTPS port should be used for LB
        const lbPort = lbHTTPSEnabled === true ? 443 : 80;
        // Allow Security Group outbound traffic for load balancer
        lbSecurityGroup.addEgressRule(ec2.Peer.ipv4(loadbalancerOutboundCIDR), ec2.Port.tcp(lbPort), `Allow outgoing traffic over port ${lbPort}`);
        // Allow Security Group inbound traffic for load balancer
        lbSecurityGroup.addIngressRule(ec2.Peer.ipv4(loadbalancerInboundCIDR), ec2.Port.tcp(lbPort), `Allow incoming traffic over port ${lbPort}`);
        // Create Security Group for web instances
        const webSecurityGroup = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
            vpc: vpc,
            description: "Security Group for the Web instances",
            securityGroupName: "web-security-group",
            allowAllOutbound: false
        });
        // Allow Security Group outbound traffic over port 80 instances
        webSecurityGroup.addEgressRule(ec2.Peer.ipv4(webserverOutboundCIDR), ec2.Port.tcp(80), 'Allow outgoing traffic over port 80');
        // Allow Security Group inbound traffic over port 80 from the Load Balancer security group
        webSecurityGroup.connections.allowFrom(new ec2.Connections({
            securityGroups: [lbSecurityGroup]
        }), ec2.Port.tcp(80));
        // Create Security Group for Database (+ replica)
        const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
            vpc: vpc,
            description: "Security Group for the RDS instance",
            securityGroupName: "db-security-group",
            allowAllOutbound: false
        });
        /*
          https://issueexplorer.com/issue/aws/aws-cdk/17205 - retain isolated subnets
          If we want to keep the DB, we need to maintain the isolated subnets and corresponding VPC.
          There is no easy way to keep the isolated subnets and destroy all the other resources in the VPC (IGW, NAT, EIP, etc.)
          Therefore, we're going to keep the whole VPC in case we want to keep the DB alive when running CDK destroy.
        */
        if (retentionPolicy === aws_cdk_lib_1.RemovalPolicy.RETAIN) {
            dbSecurityGroup.applyRemovalPolicy(retentionPolicy);
            vpc.applyRemovalPolicy(retentionPolicy);
            vpc.node.findAll().forEach(node => node instanceof aws_cdk_lib_1.CfnResource && node.applyRemovalPolicy(retentionPolicy));
        }
        // Allow inbound traffic on port 5432 from the web instances
        dbSecurityGroup.connections.allowFrom(new ec2.Connections({
            securityGroups: [webSecurityGroup]
        }), ec2.Port.tcp(5432));
        /*
          Note for code above ^: We didn't select outbound traffic for DB Security Group above.
          Setting no outbound will yield: "out -> ICMP 252-86 -> 255.255.255.255/32" to be added to the security group.
          This is used in order to disable the "all traffic" default of Security Groups. No machine can ever actually have
          the 255.255.255.255 IP address, but in order to lock it down even more we'll restrict to a nonexistent ICMP traffic type.
          Source: https://github.com/aws/aws-cdk/issues/1430
        */
        // Create the RDS instance from the custom resource defined in 'rds_infrastructure.ts'
        const rdsResource = new rds_infrastructure_1.CdkRDSResource(this, 'rdsResource', {
            applicationName,
            dbSecurityGroup,
            vpc: vpc,
            databaseProps: props.databaseSettings,
            webTierRole: webtierRole,
            retentionSetting: retentionPolicy
        });
        // get variables from rds resource
        const { rdsInstance, rdsCredentials, rdsCredentialsName } = rdsResource;
        /*
          Source for initialiser:
          https://aws.amazon.com/blogs/infrastructure-and-automation/use-aws-cdk-to-initialize-amazon-rds-instances/
          Initialiser is a Custom Resource which runs a function which executes a Lambda function to create a user
          in the RDS database with IAM authentication. Lambda function can be deleted after first execution
        */
        const initializer = new rds_initialiser_1.CdkResourceInitializer(this, 'MyRdsInit', {
            config: {
                dbCredentialsName: rdsCredentialsName,
                dbWebUsername,
                dbName
            },
            fnLogRetention: logs.RetentionDays.FIVE_MONTHS,
            fnCode: aws_lambda_1.DockerImageCode.fromImageAsset(`${__dirname}/rds-init-fn-code`, {}),
            fnTimeout: aws_cdk_lib_1.Duration.minutes(2),
            fnSecurityGroups: [],
            vpc
        });
        // Add a dependency for the initialiser to make sure it runs only after the RDS instance has been created
        initializer.customResource.node.addDependency(rdsInstance);
        // Allow the initializer function to connect to the RDS instance
        rdsInstance.connections.allowFrom(initializer.function, ec2.Port.tcp(5432));
        // Allow initializer function to read RDS instance creds secret
        rdsCredentials.grantRead(initializer.function);
        // Output the output of the initialiser, to make sure that the query was executed properly
        const output = new aws_cdk_lib_1.CfnOutput(this, 'RdsInitFnResponse', {
            value: aws_cdk_lib_1.Token.asString(initializer.response)
        });
        /*
          CREATING THE ELASTIC BEANSTALK APPLICATION
        */
        // Get the public and private subnets to deploy Elastic Beanstalk ALB and web servers in.
        const publicSubnets = vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnets;
        const privateWebSubnets = vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_NAT }).subnets;
        // A helper function to create a comma separated string from subnets ids
        const createCommaSeparatedList = function (subnets) {
            return subnets.map((subnet) => subnet.subnetId).toString();
        };
        const webserverSubnets = createCommaSeparatedList(privateWebSubnets);
        const lbSubnets = createCommaSeparatedList(publicSubnets);
        // Define settings for the Elastic Beanstalk application
        // Documentation for settings: https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/command-options-general.html
        const serviceLinkedRole = 'AWSServiceRoleForElasticBeanstalkManagedUpdates';
        var ebSettings = [
            ['aws:elasticbeanstalk:environment', 'LoadBalancerType', loadBalancerType],
            ['aws:autoscaling:launchconfiguration', 'InstanceType', instanceType],
            ['aws:autoscaling:launchconfiguration', 'IamInstanceProfile', ec2InstanceProfile.attrArn],
            ['aws:autoscaling:launchconfiguration', 'SecurityGroups', webSecurityGroup.securityGroupId],
            ['aws:ec2:vpc', 'VPCId', vpc.vpcId],
            ['aws:ec2:vpc', 'Subnets', webserverSubnets],
            ['aws:ec2:vpc', 'ELBSubnets', lbSubnets],
            ['aws:elbv2:loadbalancer', 'SecurityGroups', lbSecurityGroup.securityGroupId],
            ['aws:elasticbeanstalk:managedactions', 'ServiceRoleForManagedUpdates', serviceLinkedRole],
            ['aws:elasticbeanstalk:managedactions', 'ManagedActionsEnabled', managedActionsEnabled],
            ['aws:elasticbeanstalk:managedactions:platformupdate', 'UpdateLevel', updateLevel],
            ['aws:elasticbeanstalk:managedactions', 'PreferredStartTime', preferredUpdateStartTime],
            ['aws:elasticbeanstalk:cloudwatch:logs', 'StreamLogs', streamLogs],
            ['aws:elasticbeanstalk:cloudwatch:logs', 'DeleteOnTerminate', deleteLogsOnTerminate],
            ['aws:elasticbeanstalk:cloudwatch:logs', 'RetentionInDays', logRetentionDays],
            ['aws:elasticbeanstalk:hostmanager', 'LogPublicationControl', 'true'],
            ['aws:elasticbeanstalk:application:environment', 'RDS_HOSTNAME', rdsInstance.dbInstanceEndpointAddress],
            ['aws:elasticbeanstalk:application:environment', 'RDS_PORT', rdsInstance.dbInstanceEndpointPort],
            ['aws:elasticbeanstalk:application:environment', 'RDS_USERNAME', props.databaseSettings.dbWebUsername],
            ['aws:elasticbeanstalk:application:environment', 'RDS_DATABASE', props.databaseSettings.dbName],
            ['aws:elasticbeanstalk:application:environment', 'REGION', this.region],
        ];
        if (lbHTTPSEnabled === true) {
            const sslPolicy = lbSSLPolicy || "ELBSecurityPolicy-FS-1-2-Res-2020-10";
            const httpsSettings = [
                ['aws:elbv2:listener:default', 'ListenerEnabled', "false"],
                ['aws:elbv2:listener:443', 'ListenerEnabled', "true"],
                ['aws:elbv2:listener:443', 'SSLCertificateArns', lbHTTPSCertificateArn],
                ['aws:elbv2:listener:443', 'SSLPolicy', sslPolicy],
                ['aws:elbv2:listener:443', 'Protocol', "HTTPS"],
            ];
            ebSettings = ebSettings.concat(httpsSettings);
        }
        /* Map settings created above, to the format required for the Elastic Beanstalk OptionSettings
          [
            {
            namespace: "",
            optionName: "",
            value: ""
            },
            ....
          ]
        */
        const optionSettingProperties = ebSettings.map(setting => ({ namespace: setting[0], optionName: setting[1], value: setting[2] }));
        // Create an app version based on the sample application (from https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/nodejs-getstarted.html)
        const appVersionProps = new elasticbeanstalk.CfnApplicationVersion(this, 'EBAppVersion', {
            applicationName: applicationName,
            sourceBundle: {
                s3Bucket: encryptedBucket.bucketName,
                s3Key: zipFileName,
            },
        });
        // Create Elastic Beanstalk environment
        new elasticbeanstalk.CfnEnvironment(this, 'EBEnvironment', {
            environmentName: `${applicationName}-env`,
            applicationName: applicationName,
            solutionStackName: solutionStackName,
            versionLabel: appVersionProps.ref,
            optionSettings: optionSettingProperties,
        });
        // Make sure we've initialised DB before we deploy EB
        appVersionProps.node.addDependency(output);
        // Ensure the app and the example ZIP file exists before adding a version 
        appVersionProps.node.addDependency(appDeploymentZip);
        appVersionProps.addDependsOn(app);
    }
}
exports.ElasticBeanstalkCdkStack = ElasticBeanstalkCdkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxhc3RpY19iZWFuc3RhbGtfY2RrX3Byb2plY3Qtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJlbGFzdGljX2JlYW5zdGFsa19jZGtfcHJvamVjdC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FBaUc7QUFDakcsNkNBQTZDO0FBQzdDLDJDQUEyQztBQUMzQyxxRUFBcUU7QUFDckUseUNBQXlDO0FBQ3pDLDJDQUEyQztBQUMzQywwREFBMEQ7QUFFMUQsdURBQXdEO0FBQ3hELHVEQUEyRDtBQUMzRCw2REFBcUU7QUF5QnJFLE1BQWEsd0JBQXlCLFNBQVEsbUJBQUs7SUFDakQsWUFBWSxLQUFVLEVBQUUsRUFBVSxFQUFFLEtBQW9DO1FBQ3RFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakIsTUFBTSxFQUNKLGVBQWUsRUFDZixZQUFZLEVBQ1osT0FBTyxFQUNQLE9BQU8sRUFDUCx1QkFBdUIsRUFDdkIsd0JBQXdCLEVBQ3hCLHFCQUFxQixFQUNyQixXQUFXLEVBQ1gsaUJBQWlCLEVBQ2pCLHFCQUFxQixFQUNyQixXQUFXLEVBQ1gsd0JBQXdCLEVBQ3hCLFVBQVUsRUFDVixxQkFBcUIsRUFDckIsZ0JBQWdCLEVBQ2hCLGdCQUFnQixFQUNoQixjQUFjLEVBQ2QscUJBQXFCLEVBQ3JCLFdBQVcsR0FDWixHQUFHLEtBQUssQ0FBQTtRQUVULElBQUksY0FBYyxJQUFJLHFCQUFxQixLQUFLLEVBQUUsRUFBRTtZQUNsRCxNQUFNLElBQUksS0FBSyxDQUFDLHFGQUFxRixDQUFDLENBQUM7U0FDeEc7UUFFRCxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRTlDLE1BQU0sRUFBRSxhQUFhLEVBQUUsTUFBTSxFQUFFLGlCQUFpQixFQUFFLEdBQUcsS0FBSyxDQUFDLGdCQUFnQixDQUFBLENBQUMsNkJBQTZCO1FBRXpHLElBQUksZUFBOEIsQ0FBQztRQUNu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SyxFQUFFLFdBQVc7YUFDbkI7U0FDRixDQUFDLENBQUM7UUFFSCx1Q0FBdUM7UUFDdkMsSUFBSSxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN6RCxlQUFlLEVBQUUsR0FBRyxlQUFlLE1BQU07WUFDekMsZUFBZSxFQUFFLGVBQWU7WUFDaEMsaUJBQWlCLEVBQUUsaUJBQWlCO1lBQ3BDLFlBQVksRUFBRSxlQUFlLENBQUMsR0FBRztZQUNqQyxjQUFjLEVBQUUsdUJBQXVCO1NBQ3hDLENBQUMsQ0FBQztRQUVILHFEQUFxRDtRQUNyRCxlQUFlLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQTtRQUUxQywwRUFBMEU7UUFDMUUsZUFBZSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsQ0FBQTtRQUNwRCxlQUFlLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3BDLENBQUM7Q0FDRjtBQWxWRCw0REFrVkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTdGFjaywgUmVtb3ZhbFBvbGljeSwgQXBwLCBEdXJhdGlvbiwgQ2ZuT3V0cHV0LCBUb2tlbiwgQ2ZuUmVzb3VyY2UgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGVsYXN0aWNiZWFuc3RhbGsgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNiZWFuc3RhbGsnO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzRGVwbG95IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcblxuaW1wb3J0IHsgRG9ja2VySW1hZ2VDb2RlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSdcbmltcG9ydCB7IENka1Jlc291cmNlSW5pdGlhbGl6ZXIgfSBmcm9tICcuL3Jkc19pbml0aWFsaXNlcic7XG5pbXBvcnQgeyBDZGtSRFNSZXNvdXJjZSwgRGF0YWJhc2VQcm9wcyB9IGZyb20gJy4vcmRzX2luZnJhc3RydWN0dXJlJztcblxuZXhwb3J0IGludGVyZmFjZSBFbGFzdGljQmVhbnN0YWxrQ2RrU3RhY2tQcm9wcyB7XG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZTogc3RyaW5nO1xuICByZWFkb25seSBhcHBsaWNhdGlvbk5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgdnBjTmFtZTogc3RyaW5nO1xuICByZWFkb25seSB2cGNDaWRyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGxvYWRiYWxhbmNlckluYm91bmRDSURSOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGxvYWRiYWxhbmNlck91dGJvdW5kQ0lEUjogc3RyaW5nO1xuICByZWFkb25seSB3ZWJzZXJ2ZXJPdXRib3VuZENJRFI6IHN0cmluZztcbiAgcmVhZG9ubHkgemlwRmlsZU5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgc29sdXRpb25TdGFja05hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgbWFuYWdlZEFjdGlvbnNFbmFibGVkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHVwZGF0ZUxldmVsOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHByZWZlcnJlZFVwZGF0ZVN0YXJ0VGltZTogc3RyaW5nO1xuICByZWFkb25seSBzdHJlYW1Mb2dzOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGRlbGV0ZUxvZ3NPblRlcm1pbmF0ZTogc3RyaW5nO1xuICByZWFkb25seSBsb2dSZXRlbnRpb25EYXlzOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGxvYWRCYWxhbmNlclR5cGU6IHN0cmluZztcbiAgcmVhZG9ubHkgbGJIVFRQU0VuYWJsZWQ6IGJvb2xlYW47XG4gIHJlYWRvbmx5IGxiSFRUUFNDZXJ0aWZpY2F0ZUFybjogc3RyaW5nOyBcbiAgcmVhZG9ubHkgbGJTU0xQb2xpY3k6IHN0cmluZztcbiAgcmVhZG9ubHkgZGF0YWJhc2VTZXR0aW5nczogRGF0YWJhc2VQcm9wcztcbn1cblxuZXhwb3J0IGNsYXNzIEVsYXN0aWNCZWFuc3RhbGtDZGtTdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IEFwcCwgaWQ6IHN0cmluZywgcHJvcHM6IEVsYXN0aWNCZWFuc3RhbGtDZGtTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcbiAgICBjb25zdCB7XG4gICAgICBhcHBsaWNhdGlvbk5hbWUsXG4gICAgICBpbnN0YW5jZVR5cGUsXG4gICAgICB2cGNOYW1lLFxuICAgICAgdnBjQ2lkcixcbiAgICAgIGxvYWRiYWxhbmNlckluYm91bmRDSURSLFxuICAgICAgbG9hZGJhbGFuY2VyT3V0Ym91bmRDSURSLFxuICAgICAgd2Vic2VydmVyT3V0Ym91bmRDSURSLFxuICAgICAgemlwRmlsZU5hbWUsXG4gICAgICBzb2x1dGlvblN0YWNrTmFtZSxcbiAgICAgIG1hbmFnZWRBY3Rpb25zRW5hYmxlZCxcbiAgICAgIHVwZGF0ZUxldmVsLFxuICAgICAgcHJlZmVycmVkVXBkYXRlU3RhcnRUaW1lLFxuICAgICAgc3RyZWFtTG9ncyxcbiAgICAgIGRlbGV0ZUxvZ3NPblRlcm1pbmF0ZSxcbiAgICAgIGxvZ1JldGVudGlvbkRheXMsXG4gICAgICBsb2FkQmFsYW5jZXJUeXBlLFxuICAgICAgbGJIVFRQU0VuYWJsZWQsXG4gICAgICBsYkhUVFBTQ2VydGlmaWNhdGVBcm4sXG4gICAgICBsYlNTTFBvbGljeSxcbiAgICB9ID0gcHJvcHNcblxuICAgIGlmIChsYkhUVFBTRW5hYmxlZCAmJiBsYkhUVFBTQ2VydGlmaWNhdGVBcm4gPT09IFwiXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlBsZWFzZSBwcm92aWRlIGEgY2VydGlmaWNhdGUgQVJOIGluIGNkay5qc29uLCBvciBkaXNhYmxlIEhUVFBTIGZvciB0ZXN0aW5nIHB1cnBvc2VzXCIpO1xuICAgIH1cblxuICAgIGNvbnNvbGUubG9nKFwiQ29uZmlndXJhdGlvbiBzZXR0aW5nczogXCIsIHByb3BzKVxuXG4gICAgY29uc3QgeyBkYldlYlVzZXJuYW1lLCBkYk5hbWUsIGRiUmV0ZW50aW9uUG9saWN5IH0gPSBwcm9wcy5kYXRhYmFzZVNldHRpbmdzIC8vIGdldCBzb21lIGRhdGFiYXNlIHNldHRpbmdzXG5cbiAgICBsZXQgcmV0ZW50aW9uUG9saWN5OiBSZW1vdmFsUG9saWN5O1xuICAgIHN3aXRjaCAoZGJSZXRlbnRpb25Qb2xpY3kpIHtcbiAgICAgIGNhc2UgXCJkZXN0cm95XCI6IHJldGVudGlvblBvbGljeSA9IFJlbW92YWxQb2xpY3kuREVTVFJPWTsgYnJlYWs7XG4gICAgICBjYXNlIFwic25hcHNob3RcIjogcmV0ZW50aW9uUG9saWN5ID0gUmVtb3ZhbFBvbGljeS5TTkFQU0hPVDsgYnJlYWs7XG4gICAgICBkZWZhdWx0OiByZXRlbnRpb25Qb2xpY3kgPSBSZW1vdmFsUG9saWN5LlJFVEFJTlxuICAgIH1cblxuICAgIC8vIENyZWF0ZSBhbiBlbmNyeXB0ZWQgYnVja2V0IGZvciBkZXBsb3ltZW50cyBhbmQgbG9nIHN0b3JhZ2VcbiAgICAvLyBTMyBCdWNrZXQgbmVlZHMgYSBzcGVjaWZpYyBmb3JtYXQgZm9yIGRlcGxveW1lbnQgKyBsb2dzOiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vZWxhc3RpY2JlYW5zdGFsay9sYXRlc3QvZGcvQVdTSG93VG8uUzMuaHRtbFxuICAgIGNvbnN0IGVuY3J5cHRlZEJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0VCRW5jcnlwdGVkQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGVsYXN0aWNiZWFuc3RhbGstJHt0aGlzLnJlZ2lvbn0tJHt0aGlzLmFjY291bnR9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIHNlcnZlckFjY2Vzc0xvZ3NQcmVmaXg6ICdzZXJ2ZXJfYWNjZXNzX2xvZ3MnLFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICB9KVxuXG4gICAgLypcbiAgICAgIENyZWF0ZSBhIFZQQyB3aXRoIHRocmVlIHN1Ym5ldHMsIHNwcmVhZCBhY3Jvc3MgdHdvIEFaczpcbiAgICAgIDEuIFByaXZhdGUgc3VibmV0IHdpdGggcm91dGUgdG8gTkFUIEdhdGV3YXkgZm9yIHRoZSB3ZWJpbnN0YW5jZXNcbiAgICAgIDIuIFByaXZhdGUgc3VibmV0IHdpdGhvdXQgTkFUIEdhdGV3YXkgKGlzb2xhdGVkKSBmb3IgdGhlIGRhdGFiYXNlIGluc3RhbmNlXG4gICAgICAzLiBQdWJsaWMgc3VibmV0IHdpdGggSW50ZXJuZXQgR2F0ZXdheSArIE5BVCBHYXRld2F5IGZvciBwdWJsaWMgYWNjZXNzIGZvciBBTEIgYW5kIE5BVCBHYXRld2F5IGFjY2VzcyBmcm9tIFdlYiBpbnN0YW5jZXNcbiAgICAgIFxuICAgICAgU3RvcmUgVlBDIGZsb3cgbG9ncyBpbiB0aGUgZW5jcnlwdGVkIGJ1Y2tldCB3ZSBjcmVhdGVkIGFib3ZlXG4gICAgKi9cbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCB2cGNOYW1lLCB7XG4gICAgICBuYXRHYXRld2F5czogMSxcbiAgICAgIG1heEF6czogMixcbiAgICAgIGNpZHI6IHZwY0NpZHIsXG4gICAgICBmbG93TG9nczoge1xuICAgICAgICAnczMnOiB7XG4gICAgICAgICAgZGVzdGluYXRpb246IGVjMi5GbG93TG9nRGVzdGluYXRpb24udG9TMyhlbmNyeXB0ZWRCdWNrZXQsICd2cGMtZmxvdy1sb2dzJyksXG4gICAgICAgICAgdHJhZmZpY1R5cGU6IGVjMi5GbG93TG9nVHJhZmZpY1R5cGUuQUxMXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAncHJpdmF0ZS13aXRoLW5hdCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX05BVCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdwcml2YXRlLWlzb2xhdGVkJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ3B1YmxpYycsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICB9XG4gICAgICBdXG4gICAgfSlcblxuICAgIHZwYy5ub2RlLmFkZERlcGVuZGVuY3koZW5jcnlwdGVkQnVja2V0KVxuXG4gICAgLy8gVXBsb2FkIHRoZSBleGFtcGxlIFpJUCBmaWxlIHRvIHRoZSBkZXBsb3ltZW50IGJ1Y2tldCBcbiAgICBjb25zdCBhcHBEZXBsb3ltZW50WmlwID0gbmV3IHMzRGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgXCJEZXBsb3laaXBwZWRBcHBsaWNhdGlvblwiLCB7XG4gICAgICBzb3VyY2VzOiBbczNEZXBsb3kuU291cmNlLmFzc2V0KGAke19fZGlybmFtZX0vLi4vc3JjL2RlcGxveW1lbnRfemlwYCldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IGVuY3J5cHRlZEJ1Y2tldFxuICAgIH0pO1xuXG4gICAgLy8gRGVmaW5lIGEgbmV3IEVsYXN0aWMgQmVhbnN0YWxrIGFwcGxpY2F0aW9uXG4gICAgY29uc3QgYXBwID0gbmV3IGVsYXN0aWNiZWFuc3RhbGsuQ2ZuQXBwbGljYXRpb24odGhpcywgJ0FwcGxpY2F0aW9uJywge1xuICAgICAgYXBwbGljYXRpb25OYW1lOiBhcHBsaWNhdGlvbk5hbWUsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgcm9sZSBmb3IgdGhlIHdlYi1pbnN0YW5jZXNcbiAgICBjb25zdCB3ZWJ0aWVyUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBgJHthcHBsaWNhdGlvbk5hbWV9LXdlYnRpZXItcm9sZWAsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlYzIuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGEgbWFuYWdlZCBwb2xpY3kgZm9yIHRoZSBFTGFzdGljIEJlYW5zdGFsayB3ZWItdGllciB0byB0aGUgd2ViVGllclJvbGVcbiAgICBjb25zdCBtYW5hZ2VkUG9saWN5ID0gaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBV1NFbGFzdGljQmVhbnN0YWxrV2ViVGllcicpXG4gICAgd2VidGllclJvbGUuYWRkTWFuYWdlZFBvbGljeShtYW5hZ2VkUG9saWN5KTtcblxuICAgIC8vIENyZWF0ZSBhbiBpbnN0YW5jZSBwcm9maWxlIGZvciB0aGUgd2ViLWluc3RhbmNlIHJvbGVcbiAgICBjb25zdCBlYzJQcm9maWxlTmFtZSA9IGAke2FwcGxpY2F0aW9uTmFtZX0tRUMyV2ViSW5zdGFuY2VQcm9maWxlYFxuICAgIGNvbnN0IGVjMkluc3RhbmNlUHJvZmlsZSA9IG5ldyBpYW0uQ2ZuSW5zdGFuY2VQcm9maWxlKHRoaXMsIGVjMlByb2ZpbGVOYW1lLCB7XG4gICAgICBpbnN0YW5jZVByb2ZpbGVOYW1lOiBlYzJQcm9maWxlTmFtZSxcbiAgICAgIHJvbGVzOiBbd2VidGllclJvbGUucm9sZU5hbWVdXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgU2VjdXJpdHkgR3JvdXAgZm9yIGxvYWQgYmFsYW5jZXJcbiAgICBjb25zdCBsYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0xiU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdnBjLFxuICAgICAgZGVzY3JpcHRpb246IFwiU2VjdXJpdHkgR3JvdXAgZm9yIHRoZSBMb2FkIEJhbGFuY2VyXCIsXG4gICAgICBzZWN1cml0eUdyb3VwTmFtZTogXCJsYi1zZWN1cml0eS1ncm91cC1uYW1lXCIsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZVxuICAgIH0pXG5cbiAgICAvLyBEZXRlcm1pbmUgaWYgSFRUUCBvciBIVFRQUyBwb3J0IHNob3VsZCBiZSB1c2VkIGZvciBMQlxuICAgIGNvbnN0IGxiUG9ydCA9IGxiSFRUUFNFbmFibGVkID09PSB0cnVlID8gNDQzIDogODBcblxuICAgIC8vIEFsbG93IFNlY3VyaXR5IEdyb3VwIG91dGJvdW5kIHRyYWZmaWMgZm9yIGxvYWQgYmFsYW5jZXJcbiAgICBsYlNlY3VyaXR5R3JvdXAuYWRkRWdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmlwdjQobG9hZGJhbGFuY2VyT3V0Ym91bmRDSURSKSxcbiAgICAgIGVjMi5Qb3J0LnRjcChsYlBvcnQpLFxuICAgICAgYEFsbG93IG91dGdvaW5nIHRyYWZmaWMgb3ZlciBwb3J0ICR7bGJQb3J0fWBcbiAgICApO1xuXG4gICAgLy8gQWxsb3cgU2VjdXJpdHkgR3JvdXAgaW5ib3VuZCB0cmFmZmljIGZvciBsb2FkIGJhbGFuY2VyXG4gICAgbGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgZWMyLlBlZXIuaXB2NChsb2FkYmFsYW5jZXJJbmJvdW5kQ0lEUiksXG4gICAgICBlYzIuUG9ydC50Y3AobGJQb3J0KSxcbiAgICAgIGBBbGxvdyBpbmNvbWluZyB0cmFmZmljIG92ZXIgcG9ydCAke2xiUG9ydH1gXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBTZWN1cml0eSBHcm91cCBmb3Igd2ViIGluc3RhbmNlc1xuICAgIGNvbnN0IHdlYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1dlYlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGM6IHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlNlY3VyaXR5IEdyb3VwIGZvciB0aGUgV2ViIGluc3RhbmNlc1wiLFxuICAgICAgc2VjdXJpdHlHcm91cE5hbWU6IFwid2ViLXNlY3VyaXR5LWdyb3VwXCIsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZVxuICAgIH0pXG5cbiAgICAvLyBBbGxvdyBTZWN1cml0eSBHcm91cCBvdXRib3VuZCB0cmFmZmljIG92ZXIgcG9ydCA4MCBpbnN0YW5jZXNcbiAgICB3ZWJTZWN1cml0eUdyb3VwLmFkZEVncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5pcHY0KHdlYnNlcnZlck91dGJvdW5kQ0lEUiksXG4gICAgICBlYzIuUG9ydC50Y3AoODApLFxuICAgICAgJ0FsbG93IG91dGdvaW5nIHRyYWZmaWMgb3ZlciBwb3J0IDgwJ1xuICAgICk7XG5cbiAgICAvLyBBbGxvdyBTZWN1cml0eSBHcm91cCBpbmJvdW5kIHRyYWZmaWMgb3ZlciBwb3J0IDgwIGZyb20gdGhlIExvYWQgQmFsYW5jZXIgc2VjdXJpdHkgZ3JvdXBcbiAgICB3ZWJTZWN1cml0eUdyb3VwLmNvbm5lY3Rpb25zLmFsbG93RnJvbShcbiAgICAgIG5ldyBlYzIuQ29ubmVjdGlvbnMoe1xuICAgICAgICBzZWN1cml0eUdyb3VwczogW2xiU2VjdXJpdHlHcm91cF1cbiAgICAgIH0pLFxuICAgICAgZWMyLlBvcnQudGNwKDgwKVxuICAgIClcblxuICAgIC8vIENyZWF0ZSBTZWN1cml0eSBHcm91cCBmb3IgRGF0YWJhc2UgKCsgcmVwbGljYSlcbiAgICBjb25zdCBkYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0RiU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdnBjLFxuICAgICAgZGVzY3JpcHRpb246IFwiU2VjdXJpdHkgR3JvdXAgZm9yIHRoZSBSRFMgaW5zdGFuY2VcIixcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBcImRiLXNlY3VyaXR5LWdyb3VwXCIsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZVxuICAgIH0pXG5cbiAgICAvKlxuICAgICAgaHR0cHM6Ly9pc3N1ZWV4cGxvcmVyLmNvbS9pc3N1ZS9hd3MvYXdzLWNkay8xNzIwNSAtIHJldGFpbiBpc29sYXRlZCBzdWJuZXRzXG4gICAgICBJZiB3ZSB3YW50IHRvIGtlZXAgdGhlIERCLCB3ZSBuZWVkIHRvIG1haW50YWluIHRoZSBpc29sYXRlZCBzdWJuZXRzIGFuZCBjb3JyZXNwb25kaW5nIFZQQy5cbiAgICAgIFRoZXJlIGlzIG5vIGVhc3kgd2F5IHRvIGtlZXAgdGhlIGlzb2xhdGVkIHN1Ym5ldHMgYW5kIGRlc3Ryb3kgYWxsIHRoZSBvdGhlciByZXNvdXJjZXMgaW4gdGhlIFZQQyAoSUdXLCBOQVQsIEVJUCwgZXRjLilcbiAgICAgIFRoZXJlZm9yZSwgd2UncmUgZ29pbmcgdG8ga2VlcCB0aGUgd2hvbGUgVlBDIGluIGNhc2Ugd2Ugd2FudCB0byBrZWVwIHRoZSBEQiBhbGl2ZSB3aGVuIHJ1bm5pbmcgQ0RLIGRlc3Ryb3kuIFxuICAgICovXG4gICAgaWYgKHJldGVudGlvblBvbGljeSA9PT0gUmVtb3ZhbFBvbGljeS5SRVRBSU4pIHtcbiAgICAgIGRiU2VjdXJpdHlHcm91cC5hcHBseVJlbW92YWxQb2xpY3kocmV0ZW50aW9uUG9saWN5KVxuICAgICAgdnBjLmFwcGx5UmVtb3ZhbFBvbGljeShyZXRlbnRpb25Qb2xpY3kpXG4gICAgICB2cGMubm9kZS5maW5kQWxsKCkuZm9yRWFjaChub2RlID0+IG5vZGUgaW5zdGFuY2VvZiBDZm5SZXNvdXJjZSAmJiBub2RlLmFwcGx5UmVtb3ZhbFBvbGljeShyZXRlbnRpb25Qb2xpY3kpKVxuICAgIH1cblxuICAgIC8vIEFsbG93IGluYm91bmQgdHJhZmZpYyBvbiBwb3J0IDU0MzIgZnJvbSB0aGUgd2ViIGluc3RhbmNlc1xuICAgIGRiU2VjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd0Zyb20oXG4gICAgICBuZXcgZWMyLkNvbm5lY3Rpb25zKHtcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IFt3ZWJTZWN1cml0eUdyb3VwXVxuICAgICAgfSksXG4gICAgICBlYzIuUG9ydC50Y3AoNTQzMilcbiAgICApXG5cbiAgICAvKlxuICAgICAgTm90ZSBmb3IgY29kZSBhYm92ZSBeOiBXZSBkaWRuJ3Qgc2VsZWN0IG91dGJvdW5kIHRyYWZmaWMgZm9yIERCIFNlY3VyaXR5IEdyb3VwIGFib3ZlLlxuICAgICAgU2V0dGluZyBubyBvdXRib3VuZCB3aWxsIHlpZWxkOiBcIm91dCAtPiBJQ01QIDI1Mi04NiAtPiAyNTUuMjU1LjI1NS4yNTUvMzJcIiB0byBiZSBhZGRlZCB0byB0aGUgc2VjdXJpdHkgZ3JvdXAuXG4gICAgICBUaGlzIGlzIHVzZWQgaW4gb3JkZXIgdG8gZGlzYWJsZSB0aGUgXCJhbGwgdHJhZmZpY1wiIGRlZmF1bHQgb2YgU2VjdXJpdHkgR3JvdXBzLiBObyBtYWNoaW5lIGNhbiBldmVyIGFjdHVhbGx5IGhhdmUgXG4gICAgICB0aGUgMjU1LjI1NS4yNTUuMjU1IElQIGFkZHJlc3MsIGJ1dCBpbiBvcmRlciB0byBsb2NrIGl0IGRvd24gZXZlbiBtb3JlIHdlJ2xsIHJlc3RyaWN0IHRvIGEgbm9uZXhpc3RlbnQgSUNNUCB0cmFmZmljIHR5cGUuXG4gICAgICBTb3VyY2U6IGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9pc3N1ZXMvMTQzMFxuICAgICovXG5cbiAgICAvLyBDcmVhdGUgdGhlIFJEUyBpbnN0YW5jZSBmcm9tIHRoZSBjdXN0b20gcmVzb3VyY2UgZGVmaW5lZCBpbiAncmRzX2luZnJhc3RydWN0dXJlLnRzJ1xuICAgIGNvbnN0IHJkc1Jlc291cmNlID0gbmV3IENka1JEU1Jlc291cmNlKHRoaXMsICdyZHNSZXNvdXJjZScsIHtcbiAgICAgIGFwcGxpY2F0aW9uTmFtZSxcbiAgICAgIGRiU2VjdXJpdHlHcm91cCxcbiAgICAgIHZwYzogdnBjLFxuICAgICAgZGF0YWJhc2VQcm9wczogcHJvcHMuZGF0YWJhc2VTZXR0aW5ncyxcbiAgICAgIHdlYlRpZXJSb2xlOiB3ZWJ0aWVyUm9sZSxcbiAgICAgIHJldGVudGlvblNldHRpbmc6IHJldGVudGlvblBvbGljeVxuICAgIH0pO1xuXG4gICAgLy8gZ2V0IHZhcmlhYmxlcyBmcm9tIHJkcyByZXNvdXJjZVxuICAgIGNvbnN0IHsgcmRzSW5zdGFuY2UsIHJkc0NyZWRlbnRpYWxzLCByZHNDcmVkZW50aWFsc05hbWUgfSA9IHJkc1Jlc291cmNlXG5cbiAgICAvKlxuICAgICAgU291cmNlIGZvciBpbml0aWFsaXNlcjpcbiAgICAgIGh0dHBzOi8vYXdzLmFtYXpvbi5jb20vYmxvZ3MvaW5mcmFzdHJ1Y3R1cmUtYW5kLWF1dG9tYXRpb24vdXNlLWF3cy1jZGstdG8taW5pdGlhbGl6ZS1hbWF6b24tcmRzLWluc3RhbmNlcy9cbiAgICAgIEluaXRpYWxpc2VyIGlzIGEgQ3VzdG9tIFJlc291cmNlIHdoaWNoIHJ1bnMgYSBmdW5jdGlvbiB3aGljaCBleGVjdXRlcyBhIExhbWJkYSBmdW5jdGlvbiB0byBjcmVhdGUgYSB1c2VyXG4gICAgICBpbiB0aGUgUkRTIGRhdGFiYXNlIHdpdGggSUFNIGF1dGhlbnRpY2F0aW9uLiBMYW1iZGEgZnVuY3Rpb24gY2FuIGJlIGRlbGV0ZWQgYWZ0ZXIgZmlyc3QgZXhlY3V0aW9uXG4gICAgKi9cbiAgICBjb25zdCBpbml0aWFsaXplciA9IG5ldyBDZGtSZXNvdXJjZUluaXRpYWxpemVyKHRoaXMsICdNeVJkc0luaXQnLCB7XG4gICAgICBjb25maWc6IHtcbiAgICAgICAgZGJDcmVkZW50aWFsc05hbWU6IHJkc0NyZWRlbnRpYWxzTmFtZSxcbiAgICAgICAgZGJXZWJVc2VybmFtZSxcbiAgICAgICAgZGJOYW1lXG4gICAgICB9LFxuICAgICAgZm5Mb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5GSVZFX01PTlRIUyxcbiAgICAgIGZuQ29kZTogRG9ja2VySW1hZ2VDb2RlLmZyb21JbWFnZUFzc2V0KGAke19fZGlybmFtZX0vcmRzLWluaXQtZm4tY29kZWAsIHt9KSxcbiAgICAgIGZuVGltZW91dDogRHVyYXRpb24ubWludXRlcygyKSxcbiAgICAgIGZuU2VjdXJpdHlHcm91cHM6IFtdLFxuICAgICAgdnBjXG4gICAgfSlcblxuICAgIC8vIEFkZCBhIGRlcGVuZGVuY3kgZm9yIHRoZSBpbml0aWFsaXNlciB0byBtYWtlIHN1cmUgaXQgcnVucyBvbmx5IGFmdGVyIHRoZSBSRFMgaW5zdGFuY2UgaGFzIGJlZW4gY3JlYXRlZFxuICAgIGluaXRpYWxpemVyLmN1c3RvbVJlc291cmNlLm5vZGUuYWRkRGVwZW5kZW5jeShyZHNJbnN0YW5jZSlcblxuICAgIC8vIEFsbG93IHRoZSBpbml0aWFsaXplciBmdW5jdGlvbiB0byBjb25uZWN0IHRvIHRoZSBSRFMgaW5zdGFuY2VcbiAgICByZHNJbnN0YW5jZS5jb25uZWN0aW9ucy5hbGxvd0Zyb20oaW5pdGlhbGl6ZXIuZnVuY3Rpb24sIGVjMi5Qb3J0LnRjcCg1NDMyKSlcblxuICAgIC8vIEFsbG93IGluaXRpYWxpemVyIGZ1bmN0aW9uIHRvIHJlYWQgUkRTIGluc3RhbmNlIGNyZWRzIHNlY3JldFxuICAgIHJkc0NyZWRlbnRpYWxzLmdyYW50UmVhZChpbml0aWFsaXplci5mdW5jdGlvbilcblxuICAgIC8vIE91dHB1dCB0aGUgb3V0cHV0IG9mIHRoZSBpbml0aWFsaXNlciwgdG8gbWFrZSBzdXJlIHRoYXQgdGhlIHF1ZXJ5IHdhcyBleGVjdXRlZCBwcm9wZXJseVxuICAgIGNvbnN0IG91dHB1dCA9IG5ldyBDZm5PdXRwdXQodGhpcywgJ1Jkc0luaXRGblJlc3BvbnNlJywge1xuICAgICAgdmFsdWU6IFRva2VuLmFzU3RyaW5nKGluaXRpYWxpemVyLnJlc3BvbnNlKVxuICAgIH0pXG5cbiAgICAvKlxuICAgICAgQ1JFQVRJTkcgVEhFIEVMQVNUSUMgQkVBTlNUQUxLIEFQUExJQ0FUSU9OIFxuICAgICovXG5cbiAgICAvLyBHZXQgdGhlIHB1YmxpYyBhbmQgcHJpdmF0ZSBzdWJuZXRzIHRvIGRlcGxveSBFbGFzdGljIEJlYW5zdGFsayBBTEIgYW5kIHdlYiBzZXJ2ZXJzIGluLlxuICAgIGNvbnN0IHB1YmxpY1N1Ym5ldHMgPSB2cGMuc2VsZWN0U3VibmV0cyh7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyB9KS5zdWJuZXRzXG4gICAgY29uc3QgcHJpdmF0ZVdlYlN1Ym5ldHMgPSB2cGMuc2VsZWN0U3VibmV0cyh7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9OQVQgfSkuc3VibmV0c1xuXG4gICAgLy8gQSBoZWxwZXIgZnVuY3Rpb24gdG8gY3JlYXRlIGEgY29tbWEgc2VwYXJhdGVkIHN0cmluZyBmcm9tIHN1Ym5ldHMgaWRzXG4gICAgY29uc3QgY3JlYXRlQ29tbWFTZXBhcmF0ZWRMaXN0ID0gZnVuY3Rpb24gKHN1Ym5ldHM6IGVjMi5JU3VibmV0W10pOiBzdHJpbmcge1xuICAgICAgcmV0dXJuIHN1Ym5ldHMubWFwKChzdWJuZXQ6IGVjMi5JU3VibmV0KSA9PiBzdWJuZXQuc3VibmV0SWQpLnRvU3RyaW5nKClcbiAgICB9XG5cbiAgICBjb25zdCB3ZWJzZXJ2ZXJTdWJuZXRzID0gY3JlYXRlQ29tbWFTZXBhcmF0ZWRMaXN0KHByaXZhdGVXZWJTdWJuZXRzKVxuICAgIGNvbnN0IGxiU3VibmV0cyA9IGNyZWF0ZUNvbW1hU2VwYXJhdGVkTGlzdChwdWJsaWNTdWJuZXRzKVxuXG4gICAgLy8gRGVmaW5lIHNldHRpbmdzIGZvciB0aGUgRWxhc3RpYyBCZWFuc3RhbGsgYXBwbGljYXRpb25cbiAgICAvLyBEb2N1bWVudGF0aW9uIGZvciBzZXR0aW5nczogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2VsYXN0aWNiZWFuc3RhbGsvbGF0ZXN0L2RnL2NvbW1hbmQtb3B0aW9ucy1nZW5lcmFsLmh0bWxcbiAgICBjb25zdCBzZXJ2aWNlTGlua2VkUm9sZSA9ICdBV1NTZXJ2aWNlUm9sZUZvckVsYXN0aWNCZWFuc3RhbGtNYW5hZ2VkVXBkYXRlcydcbiAgICB2YXIgZWJTZXR0aW5ncyA9IFtcbiAgICAgIFsnYXdzOmVsYXN0aWNiZWFuc3RhbGs6ZW52aXJvbm1lbnQnLCAnTG9hZEJhbGFuY2VyVHlwZScsIGxvYWRCYWxhbmNlclR5cGVdLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNldCB0aGUgbG9hZCBiYWxhbmNlciB0eXBlIChlLmcuICdhcHBsaWNhdGlvbicgZm9yIEFMQilcbiAgICAgIFsnYXdzOmF1dG9zY2FsaW5nOmxhdW5jaGNvbmZpZ3VyYXRpb24nLCAnSW5zdGFuY2VUeXBlJywgaW5zdGFuY2VUeXBlXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNldCBpbnN0YW5jZSB0eXBlIGZvciB3ZWIgdGllclxuICAgICAgWydhd3M6YXV0b3NjYWxpbmc6bGF1bmNoY29uZmlndXJhdGlvbicsICdJYW1JbnN0YW5jZVByb2ZpbGUnLCBlYzJJbnN0YW5jZVByb2ZpbGUuYXR0ckFybl0sICAgICAgICAgICAgICAgICAgLy8gU2V0IElBTSBJbnN0YW5jZSBQcm9maWxlIGZvciB3ZWIgdGllclxuICAgICAgWydhd3M6YXV0b3NjYWxpbmc6bGF1bmNoY29uZmlndXJhdGlvbicsICdTZWN1cml0eUdyb3VwcycsIHdlYlNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkXSwgICAgICAgICAgICAgICAgLy8gU2V0IFNlY3VyaXR5IEdyb3VwIGZvciB3ZWIgdGllclxuICAgICAgWydhd3M6ZWMyOnZwYycsICdWUENJZCcsIHZwYy52cGNJZF0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGVwbG95IHJlc291cmNlcyBpbiBWUEMgY3JlYXRlZCBlYXJsaWVyXG4gICAgICBbJ2F3czplYzI6dnBjJywgJ1N1Ym5ldHMnLCB3ZWJzZXJ2ZXJTdWJuZXRzXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBEZXBsb3kgV2ViIHRpZXIgaW5zdGFuY2VzIGluIHByaXZhdGUgc3VibmV0c1xuICAgICAgWydhd3M6ZWMyOnZwYycsICdFTEJTdWJuZXRzJywgbGJTdWJuZXRzXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGVwbG95IExvYWQgQmFsYW5jZXIgaW4gcHVibGljIHN1Ym5ldHMgIFxuICAgICAgWydhd3M6ZWxidjI6bG9hZGJhbGFuY2VyJywgJ1NlY3VyaXR5R3JvdXBzJywgbGJTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZF0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQXR0YWNoIFNlY3VyaXR5IEdyb3VwIHRvIExvYWQgQmFsYW5jZXIgICAgICAgICAgICAgIFxuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazptYW5hZ2VkYWN0aW9ucycsICdTZXJ2aWNlUm9sZUZvck1hbmFnZWRVcGRhdGVzJywgc2VydmljZUxpbmtlZFJvbGVdLCAgICAgICAgICAgICAgICAgLy8gU2VsZWN0IFNlcnZpY2UgUm9sZSBmb3IgTWFuYWdlZCBVcGRhdGVzIChFbGFzdGljIEJlYW5zdGFsayB3aWxsIGF1dG9tYXRpY2FsbHkgY3JlYXRlKVxuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazptYW5hZ2VkYWN0aW9ucycsICdNYW5hZ2VkQWN0aW9uc0VuYWJsZWQnLCBtYW5hZ2VkQWN0aW9uc0VuYWJsZWRdLCAgICAgICAgICAgICAgICAgICAgLy8gV2hldGhlciBvciBub3QgdG8gZW5hYmxlIG1hbmFnZWQgYWN0aW9uc1xuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazptYW5hZ2VkYWN0aW9uczpwbGF0Zm9ybXVwZGF0ZScsICdVcGRhdGVMZXZlbCcsIHVwZGF0ZUxldmVsXSwgICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2V0IHRoZSB1cGRhdGUgbGV2ZWwgKGUuZy4gJ3BhdGNoJyBvciAnbWlub3InKVxuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazptYW5hZ2VkYWN0aW9ucycsICdQcmVmZXJyZWRTdGFydFRpbWUnLCBwcmVmZXJyZWRVcGRhdGVTdGFydFRpbWVdLCAgICAgICAgICAgICAgICAgICAgLy8gU2V0IHByZWZlcnJlZCBzdGFydCB0aW1lIGZvciBtYW5hZ2VkIHVwZGF0ZXNcbiAgICAgIFsnYXdzOmVsYXN0aWNiZWFuc3RhbGs6Y2xvdWR3YXRjaDpsb2dzJywgJ1N0cmVhbUxvZ3MnLCBzdHJlYW1Mb2dzXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXRoZXIgb3Igbm90IHRvIHN0cmVhbSBsb2dzIHRvIENsb3VkV2F0Y2hcbiAgICAgIFsnYXdzOmVsYXN0aWNiZWFuc3RhbGs6Y2xvdWR3YXRjaDpsb2dzJywgJ0RlbGV0ZU9uVGVybWluYXRlJywgZGVsZXRlTG9nc09uVGVybWluYXRlXSwgICAgICAgICAgICAgICAgICAgICAgIC8vIFdoZXRoZXIgb3Igbm90IHRvIGRlbGV0ZSBsb2cgZ3JvdXBzIHdoZW4gRWxhc3RpYyBCZWFuc3RhbGsgZW52aXJvbm1lbnQgaXMgdGVybWluYXRlZFxuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazpjbG91ZHdhdGNoOmxvZ3MnLCAnUmV0ZW50aW9uSW5EYXlzJywgbG9nUmV0ZW50aW9uRGF5c10sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTnVtYmVyIG9mIGRheXMgbG9ncyBzaG91bGQgYmUgcmV0YWluZWRcbiAgICAgIFsnYXdzOmVsYXN0aWNiZWFuc3RhbGs6aG9zdG1hbmFnZXInLCAnTG9nUHVibGljYXRpb25Db250cm9sJywgJ3RydWUnXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEVuYWJsZSBMb2dnaW5nIHRvIGJlIHN0b3JlZCBpbiBTM1xuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazphcHBsaWNhdGlvbjplbnZpcm9ubWVudCcsICdSRFNfSE9TVE5BTUUnLCByZHNJbnN0YW5jZS5kYkluc3RhbmNlRW5kcG9pbnRBZGRyZXNzXSwgICAgLy8gRGVmaW5lIEVudiBWYXJpYWJsZSBmb3IgSE9TVE5BTUVcbiAgICAgIFsnYXdzOmVsYXN0aWNiZWFuc3RhbGs6YXBwbGljYXRpb246ZW52aXJvbm1lbnQnLCAnUkRTX1BPUlQnLCByZHNJbnN0YW5jZS5kYkluc3RhbmNlRW5kcG9pbnRQb3J0XSwgICAgICAgICAgIC8vIERlZmluZSBFbnYgVmFyaWFibGUgZm9yIFBPUlRcbiAgICAgIFsnYXdzOmVsYXN0aWNiZWFuc3RhbGs6YXBwbGljYXRpb246ZW52aXJvbm1lbnQnLCAnUkRTX1VTRVJOQU1FJywgcHJvcHMuZGF0YWJhc2VTZXR0aW5ncy5kYldlYlVzZXJuYW1lXSwgICAgIC8vIERlZmluZSBFbnYgVmFyaWFibGUgZm9yIERCIHVzZXJuYW1lIHRvIGNvbm5lY3QgKHdlYiB0aWVyKVxuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazphcHBsaWNhdGlvbjplbnZpcm9ubWVudCcsICdSRFNfREFUQUJBU0UnLCBwcm9wcy5kYXRhYmFzZVNldHRpbmdzLmRiTmFtZV0sICAgICAgICAgICAgLy8gRGVmaW5lIEVudiBWYXJpYWJsZSBmb3IgREIgbmFtZSAoZGVmaW5lZCB3aGVuIFJEUyBkYiBjcmVhdGVkKVxuICAgICAgWydhd3M6ZWxhc3RpY2JlYW5zdGFsazphcHBsaWNhdGlvbjplbnZpcm9ubWVudCcsICdSRUdJT04nLCB0aGlzLnJlZ2lvbl0sICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRGVmaW5lIEVudiBWYXJpYWJsZSBmb3IgUmVnaW9uXG4gICAgXVxuXG4gICAgaWYgKGxiSFRUUFNFbmFibGVkID09PSB0cnVlKSB7XG4gICAgICBjb25zdCBzc2xQb2xpY3kgPSBsYlNTTFBvbGljeSB8fCBcIkVMQlNlY3VyaXR5UG9saWN5LUZTLTEtMi1SZXMtMjAyMC0xMFwiXG4gICAgICBjb25zdCBodHRwc1NldHRpbmdzID0gW1xuICAgICAgICBbJ2F3czplbGJ2MjpsaXN0ZW5lcjpkZWZhdWx0JywgJ0xpc3RlbmVyRW5hYmxlZCcsIFwiZmFsc2VcIl0sICAgICAgICAgICAgICAgICAgICAgICAgIC8vIERpc2FibGUgdGhlIGRlZmF1bHQgSFRUUCBsaXN0ZW5lclxuICAgICAgICBbJ2F3czplbGJ2MjpsaXN0ZW5lcjo0NDMnLCAnTGlzdGVuZXJFbmFibGVkJywgXCJ0cnVlXCJdLCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIENyZWF0ZSBhIG5ldyBIVFRQUyBsaXN0ZW5lciBvbiBwb3J0IDQ0M1xuICAgICAgICBbJ2F3czplbGJ2MjpsaXN0ZW5lcjo0NDMnLCAnU1NMQ2VydGlmaWNhdGVBcm5zJywgbGJIVFRQU0NlcnRpZmljYXRlQXJuXSwgICAgICAgICAgICAvLyBBdHRhY2ggdGhlIGNlcnRpZmljYXRlIGZvciB0aGUgY3VzdG9tIGRvbWFpblxuICAgICAgICBbJ2F3czplbGJ2MjpsaXN0ZW5lcjo0NDMnLCAnU1NMUG9saWN5Jywgc3NsUG9saWN5XSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBTcGVjaWZpZXMgdGhlIFRMUyBwb2xpY3lcbiAgICAgICAgWydhd3M6ZWxidjI6bGlzdGVuZXI6NDQzJywgJ1Byb3RvY29sJywgXCJIVFRQU1wiXSwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBTZXRzIHRoZSBwcm90b2NvbCBmb3IgdGhlIGxpc3RlbmVyIHRvIEhUVFBTXG4gICAgICBdXG4gICAgICBlYlNldHRpbmdzID0gZWJTZXR0aW5ncy5jb25jYXQoaHR0cHNTZXR0aW5ncylcbiAgICB9XG4gICAgLyogTWFwIHNldHRpbmdzIGNyZWF0ZWQgYWJvdmUsIHRvIHRoZSBmb3JtYXQgcmVxdWlyZWQgZm9yIHRoZSBFbGFzdGljIEJlYW5zdGFsayBPcHRpb25TZXR0aW5ncyBcbiAgICAgIFtcbiAgICAgICAgeyBcbiAgICAgICAgbmFtZXNwYWNlOiBcIlwiLFxuICAgICAgICBvcHRpb25OYW1lOiBcIlwiLFxuICAgICAgICB2YWx1ZTogXCJcIlxuICAgICAgICB9LFxuICAgICAgICAuLi4uXG4gICAgICBdXG4gICAgKi9cbiAgICBjb25zdCBvcHRpb25TZXR0aW5nUHJvcGVydGllczogZWxhc3RpY2JlYW5zdGFsay5DZm5FbnZpcm9ubWVudC5PcHRpb25TZXR0aW5nUHJvcGVydHlbXSA9IGViU2V0dGluZ3MubWFwKFxuICAgICAgc2V0dGluZyA9PiAoeyBuYW1lc3BhY2U6IHNldHRpbmdbMF0sIG9wdGlvbk5hbWU6IHNldHRpbmdbMV0sIHZhbHVlOiBzZXR0aW5nWzJdIH0pXG4gICAgKVxuXG4gICAgLy8gQ3JlYXRlIGFuIGFwcCB2ZXJzaW9uIGJhc2VkIG9uIHRoZSBzYW1wbGUgYXBwbGljYXRpb24gKGZyb20gaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2VsYXN0aWNiZWFuc3RhbGsvbGF0ZXN0L2RnL25vZGVqcy1nZXRzdGFydGVkLmh0bWwpXG4gICAgY29uc3QgYXBwVmVyc2lvblByb3BzID0gbmV3IGVsYXN0aWNiZWFuc3RhbGsuQ2ZuQXBwbGljYXRpb25WZXJzaW9uKHRoaXMsICdFQkFwcFZlcnNpb24nLCB7XG4gICAgICBhcHBsaWNhdGlvbk5hbWU6IGFwcGxpY2F0aW9uTmFtZSxcbiAgICAgIHNvdXJjZUJ1bmRsZToge1xuICAgICAgICBzM0J1Y2tldDogZW5jcnlwdGVkQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIHMzS2V5OiB6aXBGaWxlTmFtZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgRWxhc3RpYyBCZWFuc3RhbGsgZW52aXJvbm1lbnRcbiAgICBuZXcgZWxhc3RpY2JlYW5zdGFsay5DZm5FbnZpcm9ubWVudCh0aGlzLCAnRUJFbnZpcm9ubWVudCcsIHtcbiAgICAgIGVudmlyb25tZW50TmFtZTogYCR7YXBwbGljYXRpb25OYW1lfS1lbnZgLFxuICAgICAgYXBwbGljYXRpb25OYW1lOiBhcHBsaWNhdGlvbk5hbWUsXG4gICAgICBzb2x1dGlvblN0YWNrTmFtZTogc29sdXRpb25TdGFja05hbWUsXG4gICAgICB2ZXJzaW9uTGFiZWw6IGFwcFZlcnNpb25Qcm9wcy5yZWYsXG4gICAgICBvcHRpb25TZXR0aW5nczogb3B0aW9uU2V0dGluZ1Byb3BlcnRpZXMsXG4gICAgfSk7XG5cbiAgICAvLyBNYWtlIHN1cmUgd2UndmUgaW5pdGlhbGlzZWQgREIgYmVmb3JlIHdlIGRlcGxveSBFQlxuICAgIGFwcFZlcnNpb25Qcm9wcy5ub2RlLmFkZERlcGVuZGVuY3kob3V0cHV0KVxuXG4gICAgLy8gRW5zdXJlIHRoZSBhcHAgYW5kIHRoZSBleGFtcGxlIFpJUCBmaWxlIGV4aXN0cyBiZWZvcmUgYWRkaW5nIGEgdmVyc2lvbiBcbiAgICBhcHBWZXJzaW9uUHJvcHMubm9kZS5hZGREZXBlbmRlbmN5KGFwcERlcGxveW1lbnRaaXApXG4gICAgYXBwVmVyc2lvblByb3BzLmFkZERlcGVuZHNPbihhcHApO1xuICB9XG59XG4iXX0=