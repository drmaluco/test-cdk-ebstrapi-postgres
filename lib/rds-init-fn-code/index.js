import { createConnection } from 'postgres'
import { SecretsManager } from 'aws-sdk'

const secrets = new SecretsManager({})


// SOURCE: https://aws.amazon.com/blogs/infrastructure-and-automation/use-aws-cdk-to-initialize-amazon-rds-instances/
// See SQL Statement on line 26 to see what we had to add to the database to make IAM authentication work

export async function handler(e) {
  try {
    const { config } = e.params
    const { password, username, host } = await getSecretValue(config.dbCredentialsName)
    const connection = createConnection({
      host,
      user: username,
      password,
      multipleStatements: true
    })

    connection.connect()

    // SQL statement to create a user which uses the AWSAuthenticationPlugin
    // See https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html for more info (and Postgres example)
    const sqlStatement = `CREATE USER '${config.dbWebUsername}' GRANT rds_iam TO
                          ${config.dbName}.* TO '${config.dbWebUsername}' `;
    const res = await query(connection, sqlStatement)

    return {
      status: 'OK',
      results: res
    }
  } catch (err) {
    return {
      status: 'ERROR',
      err,
      message: err.message
    }
  }
}

function query (connection, sql) {
  return new Promise((resolve, reject) => {
    connection.query(sql, (error, res) => {
      if (error) return reject(error)

      return resolve(res)
    })
  })
}

function getSecretValue (secretId) {
  return new Promise((resolve, reject) => {
    secrets.getSecretValue({ SecretId: secretId }, (err, data) => {
      if (err) return reject(err)

      return resolve(JSON.parse(data.SecretString))
    })
  })
}
